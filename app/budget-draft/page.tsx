import "./budget.css";
import type { Metadata } from "next";
import { BudgetDraftLab } from "./budget-draft-lab";

export const metadata: Metadata = {
  title: "Budget Draft Lab | PumpFun Fantasy",
  description: "Build a five-trader Pump.fun lineup under a 100-credit fantasy budget.",
  robots: { index: false, follow: false },
};

export default function BudgetDraftPage() {
  return <BudgetDraftLab />;
}
