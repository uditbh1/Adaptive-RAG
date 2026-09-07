import {
  AzureChatOpenAI,
  AzureOpenAIEmbeddings,
  ChatOpenAI,
  OpenAIEmbeddings,
} from "@langchain/openai";

function azureInstanceName() {
  if (process.env.AZURE_OPENAI_API_INSTANCE_NAME) {
    return process.env.AZURE_OPENAI_API_INSTANCE_NAME;
  }
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? "";
  return endpoint.match(/https?:\/\/([^.]+)\.openai\.azure\.com/i)?.[1];
}

export function usesAzureOpenAI() {
  return Boolean(
    process.env.AZURE_OPENAI_API_KEY &&
      azureInstanceName() &&
      (process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME ||
        process.env.AZURE_OPENAI_DEPLOYMENT),
  );
}

export function hasLlmCredentials() {
  return Boolean(process.env.OPENAI_API_KEY || usesAzureOpenAI());
}

export function getChatModel() {
  if (usesAzureOpenAI()) {
    return new AzureChatOpenAI({
      temperature: 0,
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiInstanceName: azureInstanceName(),
      azureOpenAIApiDeploymentName:
        process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME ??
        process.env.AZURE_OPENAI_DEPLOYMENT,
      azureOpenAIApiVersion:
        process.env.AZURE_OPENAI_API_VERSION ?? "2024-08-01-preview",
      ...(process.env.AZURE_OPENAI_BASE_PATH
        ? { azureOpenAIBasePath: process.env.AZURE_OPENAI_BASE_PATH }
        : {}),
    });
  }

  return new ChatOpenAI({
    model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
    temperature: 0,
  });
}

export function getEmbeddings() {
  if (usesAzureOpenAI()) {
    return new AzureOpenAIEmbeddings({
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiInstanceName: azureInstanceName(),
      azureOpenAIApiEmbeddingsDeploymentName:
        process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME ??
        process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ??
        process.env.OPENAI_EMBEDDING_MODEL ??
        "text-embedding-3-small",
      azureOpenAIApiVersion:
        process.env.AZURE_OPENAI_API_VERSION ?? "2024-08-01-preview",
    });
  }

  return new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  });
}
