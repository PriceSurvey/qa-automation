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

https: const slackChannel = process.env.ENVIRONMENT === "development" ? "test-n8n" : "automacao-gpa";

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

async function getPricerProfile(id: number, cache?: Map<number, any>) {
  if (cache && cache.has(id)) {
    return cache.get(id);
  }
  const response = await client.get(`/pricer/${id}/`);
  cache?.set(id, response.data);
  return response.data;
}

async function getActiveLists() {
  const response = await client.get(
    `${process.env.BASE_API_URL}/evaluation-list/?isFinished=false&current_evaluator_id=${process.env.EVALUATOR_ID}`
  );
  return response.data;
}

async function getEvaluationItems(listId: string) {
  const response = await client.get(`/evaluation-list/${listId}`);
  return response.data; //.filter((item: any) => item.status !== 4);
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
    console.log(`🤖 Item ${evaluationItem.id} evaluated`);
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

function formatEvaluationItemToApprove(evaluationItem: any) {
  const answers = evaluationItem.data_info_before.answers.map((a: any) => ({
    question_key_type: a.question_key_type,
    survey_question: a.survey_question,
    value: a.value === "" || a.value === undefined ? null : a.value,
  }))
  const newQuestions = evaluationItem.survey_questions
  .filter((sq:any)=>answers.findIndex((a:any)=>a.survey_question === sq.id) === -1)
  .map((sq:any)=>({
    survey_question: sq.id,
    value: null,
  }))
  return {
    id: evaluationItem.id,
    score: 5,
    approved: true,
    evaluated: true,
    data_info_after: {
      answers:[...answers,...newQuestions]
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
  // console.log(`Approving item ${JSON.stringify(evaluationItem)}`);
  const validate = canUpdateItem(evaluationItem);
  if (validate.canUpdate) {
    console.log(`Item ${evaluationItem.id} will be approved`);
    return evaluateItem(evaluationItem, formatEvaluationItemToApprove(evaluationItem));
  } else {
    console.log("Can't approve item: ", validate);
    return null;
  }
}

function canUpdateItem(evaluationItem: any) {
  const eanAswered = evaluationItem.data_info_before.answers.find(
    (answer: any) => answer.question_key.includes("barcode") || answer.question_key.includes("ean")
  );
  // const customerIds = [
  //   ETERNIT,
  //   ABC_CONSTRUCAO,
  //   HALEON,
  //   STECK,
  //   NETAFIM,
  //   KILLING,
  //   TIGRE,
  //   IVAIPORA,
  //   FIGUEIREDO,
  //   CARVALHO,
  //   GPA,
  // ];
  // if (!customerIds.includes(evaluationItem.customer_id)) return { error: "WRONG_CUSTOMER", canUpdate: false };
  if (evaluationItem.status !== 3)
    return {
      error: "WRONG_ITEM_STATUS",
      details: `Item ${evaluationItem.id} status: ${evaluationItem.status}`,
      canUpdate: false,
    };
  if (
    eanAswered &&
    evaluationItem.product_info?.ean &&
    evaluationItem.product_info.ean?.toString() !== eanAswered.value?.toString()
  ) {
    return {
      error: "WRONG_EAN",
      details: `Item ${evaluationItem.id} ean: ${evaluationItem.product_info?.ean} -> answered: ${eanAswered.value}`,
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

async function evaluateItemsBulk() {
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

  let pricersCache = new Map();

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

  // const listChunks = chunk(, 1);
  for (const list of activeLists) {
    console.log(`Evaluating list ${list.id}`);
    const start = new Date().getTime();
    const { items } = await getEvaluationItems(list.id);
    console.log(`List ${list.id} has ${items.length} items`);
    const filtered = items.filter((item: any) => item.approved === null && item.evaluated === null);
    console.log(`Evaluating ${filtered?.length} items for list ${list.id}`);
    if (filtered.length === 0) return;

    for (let item of filtered) {
      const pricer = await getPricerProfile(item.pricer_id, pricersCache);
      if (pricer.average_score >= 4.85) {
        console.log(`Pricer score: ${pricer.average_score}`);
        const detailed = await getEvaluationItemDetails(item.id);
        if (detailed.status !== 4) {
          await approveItem(detailed);
        }
      } else {
        console.log(`Item ${item.id} has a low score: ${pricer.average_score}`);
      }
    }
    const end = new Date().getTime();
    console.log(`List ${list.id} evaluated in ${+((end - start) / 1000).toFixed(2)}s`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
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
