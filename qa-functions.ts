import axios from "axios";
import { sendMessageToSlackChannel } from "./slack-notifications";
import { chunk } from "lodash";
import { CrawlerState, db } from "./db";

const client = axios.create({
  baseURL: process.env.BASE_API_URL,
  headers: {
    Authorization: `Token ${process.env.BOT_TOKEN}`,
  },
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
  return response.data;
}

async function getEvaluationItemDetails(evaluationItemId: string) {
  const response = await client.post(`/evaluation-item/${evaluationItemId}/retrieve-to-evaluate/`);
  return response.data;
}

async function evaluateItem(evaluationItem: any, evaluation: any) {
  const response = await client.patch(`/evaluation-item/${evaluationItem.id}/`, {
    ...evaluationItem,
    ...evaluation,
  });
  return response.data;
}
async function releaseEvaluationList(listId: string) {}

async function approveItem(evaluationItem: any) {
  if (canApproveItem(evaluationItem)) {
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
    console.log("Can't approve item: ", evaluationItem.id);
    return null;
  }
}

function canApproveItem(evaluationItem: any) {
  const eanAswered = evaluationItem.data_info_before.answers.find((answer: any) =>
    answer.question_key.includes("barras")
  );
  if (evaluationItem.customer_id !== 133) return false;
  if (evaluationItem.status !== 3) return false;
  if (evaluationItem.pricer_email !== "pricesurvey@pricesurvey.io") return false;
  if (eanAswered && evaluationItem.product_info?.ean)
    return evaluationItem.product_info.ean?.toString() === eanAswered?.toString();

  return true;
}

async function evaluateItems() {
  await sendMessageToSlackChannel(
    slackChannel,
    `${new Date().toISOString()}\n🤖 Iniciando a avaliação automática de itens para pesquisas internas de GPA.`
  );
  const activeLists = await getActiveLists();
  console.log(`🤖 Existem ${activeLists.length} listas para o robô avaliar.`);
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
  }, 3_000);

  for (const listChunk of listChunks) {
    await Promise.allSettled(
      listChunk.map(async (list: any) => {
        console.log(`Evaluating list ${list.id}`);
        const { items } = await getEvaluationItems(list.id);
        console.log(`Evaluating ${items?.length} items`);

        const itemsChunks: any[] = chunk(items as any[], 5);
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
      })
    );
  }
  clearInterval(intervalRef);
  await sendMessageToSlackChannel(
    slackChannel,
    `${new Date().toISOString()}\n🤖 Todas as listas atribuídas para mim foram avaliadas.`
  );
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
