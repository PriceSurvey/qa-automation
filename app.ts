import "dotenv/config";
import express from "express";
import { startEvaluation } from "./qa-functions";
import { isAuth } from "./auth";

const app = express();
const port = process.env.PORT || 3001;
app.get("/health", (req, res) => {
  res.send("OK");
});

app.get("/", isAuth, (req, res) => {
  res.send({
    botToken: process.env.BOT_TOKEN,
    evaluatorId: process.env.EVALUATOR_ID,
  });
});
app.get("/start-evaluation", isAuth, async (req, res) => {
  try {
    await startEvaluation();
    res.send("OK");
  } catch (e) {
    console.log("err: ", e);
    res.send(e);
  }
});

// https://dev.pricesurvey.io/api/qa/v0/evaluation-list/?current_evaluator_id=6641500&isFinished=false

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
