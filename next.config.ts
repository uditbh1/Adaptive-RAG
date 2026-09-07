import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: [
    "@langchain/langgraph",
    "@langchain/openai",
    "@langchain/tavily",
    "@langchain/textsplitters",
    "@langchain/core",
    "@langchain/qdrant",
    "@qdrant/js-client-rest",
    "mongodb",
  ],
};

export default nextConfig;
