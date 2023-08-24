import axios from "axios";

export const sendMessageToSlackChannel = async (channel: string, msg: string) => {
  return true;
  return axios.post("https://n8n.pricesurvey.io/webhook/qa-notification", {
    channelName: channel,
    msg,
  }).catch((error)=>console.log('error: ', error);
};
