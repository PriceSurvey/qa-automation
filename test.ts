import { sendMessageToSlackChannel } from "./slack-notifications";

async () => {
  while (true) {
    await sendMessageToSlackChannel("test-n8n", "test").then(() => console.log("done"));
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
};
