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

const ETERNIT = 137;
const HALEON = 175;
const STECK = 173;
const ABC_CONSTRUCAO = 179;
const NETAFIM = 128;
const KILLING = 101;
const TIGRE = 169;
const IVAIPORA = 195;
const FIGUEIREDO = 165;
const CARVALHO = 194;
const GPA = 133;

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
  if (!evaluationItem) throw new Error("evaluationItem is required");
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

function formatEvaluationItemToApprove(evaluationItem: any) {
  return {
    id: evaluationItem.id,
    score: 5,
    approved: true,
    evaluated: true,
    data_info_after: {
      answers: evaluationItem.data_info_before.answers.map((a: any) => ({
        survey_question: a.survey_question,
        value: a.value === "" || a.value === undefined ? null : a.value,
      })),
    },
  };
}
function formatEvaluationItemToRefuse(evaluationItem: any) {
  return {
    id: evaluationItem.id,
    score: 1,
    reason: 14, // Preço incorreto
    approved: false,
    evaluated: true,
    data_info_after: {
      answers: evaluationItem.data_info_before.answers.map((a: any) => ({
        survey_question: a.survey_question,
        value: a.value === "" || a.value === undefined ? null : a.value,
      })),
    },
  };
}

async function approveItem(evaluationItem: any) {
  const validate = canUpdateItem(evaluationItem);
  if (validate.canUpdate) {
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

function canUpdateItem(evaluationItem: any) {
  const eanAswered = evaluationItem.data_info_before.answers.find((answer: any) =>
    answer.question_key.includes("barcode")
  );
  const customerIds = [
    ETERNIT,
    ABC_CONSTRUCAO,
    HALEON,
    STECK,
    NETAFIM,
    KILLING,
    TIGRE,
    IVAIPORA,
    FIGUEIREDO,
    CARVALHO,
    GPA,
  ];
  if (!customerIds.includes(evaluationItem.customer_id)) return { error: "WRONG_CUSTOMER", canUpdate: false };
  if (evaluationItem.status !== 3)
    return {
      error: "WRONG_ITEM_STATUS",
      details: `Item ${evaluationItem.id} status: ${evaluationItem.status}`,
      canUpdate: false,
    };
  if (evaluationItem.pricer_email !== "pricesurvey@pricesurvey.io")
    return {
      error: "WRONG_PRICER",
      details: `Item ${evaluationItem.id} Pricer: ${evaluationItem.pricer.email}`,
      canUpdate: false,
    };
  if (
    eanAswered &&
    evaluationItem.product_info?.ean &&
    evaluationItem.product_info.ean?.toString() !== eanAswered.value?.toString()
  ) {
    return {
      error: "WRONG_EAN",
      details: `Item ${evaluationItem.id} ean: ${evaluationItem.id}`,
      canUpdate: false,
    };
  }

  return { canUpdate: true };
}

async function approveBulk(evaluationItems: any[], retryCount: number = 0): Promise<any> {
  try {
    console.log("approveBulk started");
    const ids = evaluationItems.map((item: any) => item.id);
    const { data: items } = await client.post(`/evaluation-item/bulk-retrieve-to-evaluate/`, ids);
    console.log("items length: ", items.length);

    console.log("Finished getting detailed items");
    const payload = items
      .filter((item: any) => {
        const check = canUpdateItem(item);
        // console.log("check: ", check);
        return check.canUpdate;
      })
      .map((item: any) => {
        return formatEvaluationItemToApprove(item);
      });
    console.log(`payload allowed to be approved: ${payload.length}`);
    const response = await client.patch(`/evaluation-item/bulk-update/`, payload);
    console.log("response: ", response.data?.length);
    return response.data;
  } catch (error) {
    console.log("error: ", error);
    console.log(`🤖 Error evaluating list ${evaluationItems[0]?.evaluation_list}. Retrying...`);
    throw error;
  }
}
async function refuseBulk(evaluationItemIds: number[], retryCount: number = 0): Promise<any> {
  try {
    console.log("refuseBulk started");
    const chunks = chunk(evaluationItemIds, 250);
    for (const chunk of chunks) {
      console.log("chunk: ", chunk.length);
      const { data: items } = await client.post(`/evaluation-item/bulk-retrieve-to-evaluate/`, chunk);
      console.log("items length: ", items.length);

      console.log("Finished getting detailed items");
      const payload = items
        .filter((item: any) => canUpdateItem(item).canUpdate)
        .map((item: any) => {
          return formatEvaluationItemToRefuse(item);
        });
      console.log(`payload allowed to be refused: ${payload.length}`);
      const response = await client.patch(`/evaluation-item/bulk-update/`, payload);
      console.log("response: ", response.data?.length);
    }
  } catch (error) {
    console.log("error: ", error);
    console.log(`🤖 Error evaluating list. Retrying...`);
    throw error;
  }
}

async function evaluateItems() {
  await sendMessageToSlackChannel(
    slackChannel,
    `${new Date().toISOString()}\n🤖 Iniciando a avaliação automática de itens para pesquisas internas.`
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

  const evaluated = new Set();
  const notEvaluated = new Set();

  // const intervalRef = setInterval(async () => {
  //   // NOTE: It takes between 5-10s for the message to be sent to Slack, so the interval
  //   // should consider it.
  //   await sendMessageToSlackChannel(
  //     slackChannel,
  //     `🤖 *Progresso*:
  //   - Já foram avaliados ${evaluated.size + notEvaluated.size} itens
  //   - Itens que foram aprovados: ${evaluated.size}
  //   - Itens que não puderam ser aprovados: ${notEvaluated.size}
  //   `
  //   );
  // }, 10_000);

  const listChunks = chunk(activeLists, 8);
  for (const listChunk of listChunks) {
    await Promise.allSettled(
      listChunk.map(async (list: any) => {
        console.log(`Evaluating list ${list.id}`);
        const start = new Date().getTime();
        const { items } = await getEvaluationItems(list.id);
        console.log(`List ${list.id} has ${items.length} items`);
        const filtered = items; //.filter((item: any) => item.status === 0);
        console.log(`Evaluating ${filtered?.length} items for list ${list.id}`);
        if (filtered.length === 0) return;
        await approveBulk(filtered);
        const end = new Date().getTime();
        console.log(`List ${list.id} evaluated in ${+((end - start) / 1000).toFixed(2)}s`);
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      })
    );
  }

  // clearInterval(intervalRef);
  await sendMessageToSlackChannel(
    slackChannel,
    `${new Date().toISOString()}\n🤖 Todas as listas atribuídas para mim foram avaliadas.`
  ).catch((e) => console.log("could not notify slack"));
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
      `${new Date().toISOString()}\n🤖 Já estou avaliando itens para pesquisas internas.`
    ).catch((e) => console.log("could not notify slack"));
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
