import "server-only";

import { RTMClient } from "@slack/rtm-api";
import { z } from "zod";

import { env } from "./env";

class slackClients {
  static #rtm: RTMClient;

  private constructor() {
    throw new Error("Cannot instantiate slackClients");
  }

  static get rtm() {
    if (!this.#rtm) {
      this.#rtm = new RTMClient(env.SLACK_TOKEN);
    }
    return this.#rtm;
  }
}

const channel = env.SLACK_CHANNEL;

const eventSchema = z.object({
  channel: z.string().optional(),
  subtype: z.string().optional(),
});

export const EVENT_CHAT_MESSAGE_ADDED = "CHAT_MESSAGE_ADDED" as const;
export const EVENT_CHAT_MESSAGE_EDITED = "CHAT_MESSAGE_EDITED" as const;
export const EVENT_CHAT_MESSAGE_DELETED = "CHAT_MESSAGE_DELETED" as const;

export async function subscribe(
  callback: (
    type:
      | typeof EVENT_CHAT_MESSAGE_ADDED
      | typeof EVENT_CHAT_MESSAGE_EDITED
      | typeof EVENT_CHAT_MESSAGE_DELETED,
  ) => void,
) {
  function subscriber(rawEvent: unknown) {
    const event = eventSchema.parse(rawEvent);

    if (event.channel === channel) {
      if (event.subtype == null || event.subtype === "bot_message") {
        callback(EVENT_CHAT_MESSAGE_ADDED);
      }

      if (event.subtype === "message_changed") {
        callback(EVENT_CHAT_MESSAGE_EDITED);
      }

      if (event.subtype === "message_deleted") {
        callback(EVENT_CHAT_MESSAGE_DELETED);
      }
    }
  }

  slackClients.rtm.on("message", subscriber);

  if (!slackClients.rtm.connected) {
    await slackClients.rtm.start();
  }

  return function unsubscribe() {
    return void slackClients.rtm.off("message", subscriber);
  };
}
