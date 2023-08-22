import { sendMessageToSlackChannel } from "./slack-notifications";

sendMessageToSlackChannel("test-n8n", "test").then(() => console.log("done"));
