import axios from "axios";

export const sendMessageToSlackChannel = async (channel: string, msg: string) => {
  console.log(msg);
  axios
    .post("https://n8n.pricesurvey.io/webhook/qa-notification-2/", {
      channelName: channel,
      msg,
    })
    .catch((error) => console.log("couldn't notify slack: ", error));
};
