import "dotenv/config";
import express from "express";
import { startEvaluation } from "./qa-functions-v2";
import { isAuth } from "./auth";
// import { db } from "./db";
import { db } from "./db";

const app = express();
app.use(express.json());
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
app.post("/start-evaluation", isAuth, async (req, res) => {
  try {
    const { force } = req.body;
    startEvaluation(force);
    res.send("OK");
  } catch (e) {
    console.log("err: ", e);
    res.send(e);
  }
});

// https://dev.pricesurvey.io/api/qa/v0/evaluation-list/?current_evaluator_id=6641500&isFinished=false

app.listen(port, async () => {
  console.log(`Example app listening on port ${port}!`);
});
