import { z } from "zod";

/**
 * Discord message schema - used by both gateway events and API responses.
 * Only includes fields we actually use.
 */
export const DiscordMessageSchema = z.object({
  type: z.number(),
  id: z.string(),
  channel_id: z.string().optional(), // Present in gateway events, not in API single-message fetch
  author: z.object({ id: z.string() }),
  content: z.string(),
  edited_timestamp: z.string().nullable().optional(),
  message_reference: z.object({ message_id: z.string().optional() }).optional(),
});

export type DiscordMessage = z.infer<typeof DiscordMessageSchema>;
