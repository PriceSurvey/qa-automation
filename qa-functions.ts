import axios from "axios";
import { sendMessageToSlackChannel } from "./slack-notifications";
import { chunk } from "lodash";
import { CrawlerState, db } from "./db";

const proxy = {
  host: "brd.superproxy.io",
  protocol: "http",
  port: 22225,
  auth: {
    username: "brd-customer-hl_68a95eee-zone-datacenter_br",
    password: "t4szl9948zps",
  },
};
const client = axios.create({
  baseURL: process.env.BASE_API_URL,
  headers: {
    Authorization: `Token ${process.env.BOT_TOKEN}`,
  },
  // proxy,
});

const slackChannel = process.env.ENVIRONMENT === "development" ? "test-n8n" : "automacao-gpa";

async function getActiveLists() {
  const response = await client.get(
    `${process.env.BASE_API_URL}/evaluation-list/?isFinished=false&current_evaluator_id=${process.env.EVALUATOR_ID}`
  );
  return response.data;
}

async function getEvaluationItems(listId: string) {
  const response = await client.get(`/evaluation-list/${listId}`);
  return response.data; //.filter((item: any) => item.status === 3);
}

async function getEvaluationItemDetails(evaluationItemId: string) {
  const response = await client.post(`/evaluation-item/${evaluationItemId}/retrieve-to-evaluate/`);
  return response.data;
}

async function evaluateItem(evaluationItem: any, evaluation: any, retryCount: number = 0): Promise<any> {
  try {
    const response = await client.patch(`/evaluation-item/${evaluationItem.id}/`, {
      ...evaluationItem,
      ...evaluation,
    });
    return response.data;
  } catch (error) {
    if (retryCount > 3) {
      throw error;
    }
    console.log(`🤖 Error evaluating item ${evaluationItem.id}. Retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return evaluateItem(evaluationItem, evaluation, (retryCount += 1));
  }
}
async function releaseEvaluationList(listId: string) {}

async function approveItem(evaluationItem: any) {
  const validate = canApproveItem(evaluationItem);
  if (validate.canApprove) {
    return evaluateItem(evaluationItem, {
      score: 5,
      approved: true,
      evaluated: true,
      data_info_after: {
        answers: evaluationItem.data_info_before.answers.map((a: any) => ({
          survey_question: a.survey_question,
          value: a.value === "" || a.value === undefined ? null : a.value,
        })),
      },
    });
  } else {
    console.log("Can't approve item: ", validate);
    return null;
  }
}

function canApproveItem(evaluationItem: any) {
  const eanAswered = evaluationItem.data_info_before.answers.find((answer: any) =>
    answer.question_key.includes("barcode")
  );
  if (evaluationItem.customer_id !== 133) return { error: "WRONG_CUSTOMER", canApprove: false };
  if (evaluationItem.status !== 3)
    return {
      error: "WRONG_ITEM_STATUS",
      details: `Item ${evaluationItem.id} status: ${evaluationItem.status}`,
      canApprove: false,
    };
  if (evaluationItem.pricer_email !== "pricesurvey@pricesurvey.io")
    return {
      error: "WRONG_PRICER",
      details: `Item ${evaluationItem.id} Pricer: ${evaluationItem.pricer.email}`,
      canApprove: false,
    };
  if (eanAswered && evaluationItem.product_info?.ean) {
    const canApprove = evaluationItem.product_info.ean?.toString() === eanAswered.value?.toString();
    return {
      error: "WRONG_EAN",
      details: `Item ${evaluationItem.id} ean: ${evaluationItem.id}`,
      canApprove: canApprove,
    };
  }

  return { canApprove: true };
}

async function evaluateItems() {
  await sendMessageToSlackChannel(
    slackChannel,
    `${new Date().toISOString()}\n🤖 Iniciando a avaliação automática de itens para pesquisas internas de GPA.`
  );
  const activeLists = await getActiveLists();
  // console.log(`🤖 Existem ${activeLists.length} listas para o robô avaliar.`);
  const listMessage =
    activeLists.length > 1
      ? `🤖 Existem ${activeLists.length} listas para o robô avaliar.`
      : `🤖 Existe ${activeLists.length} lista para o robô avaliar.`;
  await sendMessageToSlackChannel(
    slackChannel,
    activeLists.length ? listMessage : "🤖 Não existem listas para avaliar."
  );

  const listChunks = chunk(activeLists, 2);
  const evaluated = new Set();
  const notEvaluated = new Set();

  const intervalRef = setInterval(async () => {
    // NOTE: It takes between 5-10s for the message to be sent to Slack, so the interval
    // should consider it.
    await sendMessageToSlackChannel(
      slackChannel,
      `🤖 *Progresso*:
    - Já foram avaliados ${evaluated.size + notEvaluated.size} itens
    - Itens que foram aprovados: ${evaluated.size}
    - Itens que não puderam ser aprovados: ${notEvaluated.size}
    `
    );
  }, 10_000);

  for (const list of activeLists) {
    // for (const list of listChunk) {
    console.log(`Evaluating list ${list.id}`);
    const { items } = await getEvaluationItems(list.id);
    console.log(`Evaluating ${items?.length} items`);
    const filtered = items.filter((item: any) => item.status === 3);

    const itemsChunks: any[] = chunk(filtered as any[], 10);
    for (const itemChunk of itemsChunks) {
      await Promise.allSettled(
        itemChunk.map(async (evaluationItem: any) => {
          const evaluationItemDetails = await getEvaluationItemDetails(evaluationItem.id);
          const evaluatedItem = await approveItem(evaluationItemDetails);
          if (evaluatedItem) {
            console.log(`Evaluated item ${evaluatedItem.id}.`);
            evaluated.add(evaluationItem.id);
          } else {
            notEvaluated.add(evaluationItem.id);
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        })
      );
    }
    // }
    // await Promise.allSettled(
    //   listChunk.map(async (list: any) => {
    //     console.log(`Evaluating list ${list.id}`);
    //     const { items } = await getEvaluationItems(list.id);
    //     console.log(`Evaluating ${items?.length} items`);

    //     const itemsChunks: any[] = chunk(items as any[], 5);
    //     for (const itemChunk of itemsChunks) {
    //       await Promise.allSettled(
    //         itemChunk.map(async (evaluationItem: any) => {
    //           const evaluationItemDetails = await getEvaluationItemDetails(evaluationItem.id);
    //           const evaluatedItem = await approveItem(evaluationItemDetails);
    //           if (evaluatedItem) {
    //             console.log(`Evaluated item ${evaluatedItem.id}.`);
    //             evaluated.add(evaluationItem.id);
    //           } else {
    //             notEvaluated.add(evaluationItem.id);
    //           }
    //           await new Promise((resolve) => setTimeout(resolve, 300));
    //         })
    //       );
    //     }
    //   })
    // );
  }
  clearInterval(intervalRef);
  await sendMessageToSlackChannel(
    slackChannel,
    `${new Date().toISOString()}\n🤖 Todas as listas atribuídas para mim foram avaliadas.`
  );
  console.log("finished");
}

async function startEvaluation(force: boolean = false) {
  /**
   * Steps:
   * 1. Get active lists
   * 2. For every active list
   *  2.1 Get evaluation items
   *  2.2 For every evaluation item
   *    2.2.1 Get evaluation item details
   *    2.2.2 Evaluate item
   */
  const crawlerState = await db.getObjectDefault<CrawlerState>("/crawlerState", CrawlerState.NOT_RUNNING);
  console.log("🤖 Crawler state: ", crawlerState);
  console.log("🤖 Should force: ", force);
  if (crawlerState === "RUNNING" && !force) {
    console.log("🤖 Crawler is already running.");
    await sendMessageToSlackChannel(
      slackChannel,
      `${new Date().toISOString()}\n🤖 Já estou avaliando itens para pesquisas internas de GPA.`
    );
  } else {
    await db.push("/crawlerState", CrawlerState.RUNNING);
    try {
      await evaluateItems();
    } finally {
      await db.push("/crawlerState", CrawlerState.NOT_RUNNING);
    }
  }
}

export { startEvaluation };
