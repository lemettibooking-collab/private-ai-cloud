import type { OwnerAI044ProofView } from "./ai044-proof";
export type OwnerOpenAIApiProofView = Readonly<{status:"unavailable"}> | (Extract<OwnerAI044ProofView,{status:"available"}> & Readonly<{
  mode:"openai_api";maximumCostUsdMicros:number;remainingDailyBudgetUsdMicros:number;repositoryId:string;
}>);
