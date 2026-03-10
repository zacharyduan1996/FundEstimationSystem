import type { FundInstrumentType } from "./types";

const ETF_PREFIXES = ["15", "50", "51", "52", "56", "58", "59"];
const LOF_PREFIXES = ["16"];

export function detectFundInstrumentType(code: string): FundInstrumentType {
  const normalized = code.trim();

  if (LOF_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "lof";
  }

  if (ETF_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "etf";
  }

  return "open_fund";
}

export function resolveEastMoneySecid(code: string): string {
  const normalized = code.trim();

  if (/^(5|6|9)/.test(normalized)) {
    return `1.${normalized}`;
  }

  return `0.${normalized}`;
}
