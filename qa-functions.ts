import axios from "axios";
import { sendMessageToSlackChannel } from "./slack-notifications";

const client = axios.create({
  baseURL: "https://dev.pricesurvey.io/api/qa/v0",
  headers: {
    Authorization: `Token ${process.env.BOT_TOKEN}`,
  },
});

const slackChannel = "projeto-gpa";

async function getActiveLists() {
  const response = await client.get(
    `https://dev.pricesurvey.io/api/qa/v0/evaluation-list/?isFinished=false&current_evaluator_id=${process.env.EVALUATOR_ID}`
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
  }
}

function canApproveItem(evaluationItem: any) {
  const eanAswered = evaluationItem.data_info_before.answers.find((answer: any) =>
    answer.question_key.includes("barras")
  );
  // if (evaluationItem.customer_id !== 133) return false;
  if (evaluationItem.status !== 3) return false;
  // if (!eanAswered || !evaluationItem.product_info?.ean) return false;
  // if (evaluationItem.pricer_email !== "isac@pricesurvey.io") return false; // pricesurvey@pricesurvey.io
  // if (evaluationItem.product_info.ean?.toString() === eanAswered?.toString()) return true;

  return true;
}

async function startEvaluation() {
  /**
   * Steps:
   * 1. Get active lists
   * 2. For every active list
   *  2.1 Get evaluation items
   *  2.2 For every evaluation item
   *    2.2.1 Get evaluation item details
   *    2.2.2 Evaluate item
   */
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
  for (const list of activeLists) {
    let evaluatedItemsCount = 0;
    console.log(`Evaluating list ${list.id}`);
    await sendMessageToSlackChannel(slackChannel, `🤖 Iniciando a avaliação da lista ${list.id}.`);
    const { items } = await getEvaluationItems(list.id);
    console.log(`Evaluating ${items?.length} items`);

    const intervalRef = setInterval(async () => {
      // NOTE: It takes between 5-10s for the message to be sent to Slack, so the interval
      // should consider it.
      await sendMessageToSlackChannel(
        slackChannel,
        `🤖 Já foram avaliados ${evaluatedItemsCount}/${items.length} itens (${Math.round(
          (evaluatedItemsCount / items.length) * 100
        )}%).`
      );
    }, 7_000);

    for (const evaluationItem of items) {
      const evaluationItemDetails = await getEvaluationItemDetails(evaluationItem.id);
      const evaluatedItem = await approveItem(evaluationItemDetails);
      if (evaluatedItem) {
        console.log(`Evaluated item ${evaluatedItem.id}.`);
      }
      evaluatedItemsCount++;
      // await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    clearInterval(intervalRef);
  }
  await sendMessageToSlackChannel(
    slackChannel,
    `${new Date().toISOString()}\n🤖 Todas as listas atribuídas para mim foram avaliadas.`
  );
}

export { startEvaluation };
