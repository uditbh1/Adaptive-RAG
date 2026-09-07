import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

export function getChatModel() {
  return new ChatOpenAI({
    model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
    temperature: 0,
  });
}

export function getEmbeddings() {
  return new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  });
}
