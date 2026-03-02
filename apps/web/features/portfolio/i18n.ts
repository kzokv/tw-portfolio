import type { LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";

export function mapRecomputeStatus(locale: LocaleCode, status: string): string {
  const normalized = status.toUpperCase();
  if (locale === "zh-TW") {
    const statusMap: Record<string, string> = {
      CONFIRMED: "已確認",
      PREVIEWED: "已預覽",
      APPLIED: "已套用",
      FAILED: "失敗",
    };
    return statusMap[normalized] ?? status;
  }
  return status;
}

export function formatRecomputeMessage(locale: LocaleCode, status: string, itemsCount: number): string {
  const localizedStatus = mapRecomputeStatus(locale, status);
  if (locale === "zh-TW") {
    return `重算${localizedStatus}，共 ${itemsCount} 筆項目`;
  }
  return `Recompute ${localizedStatus}, items: ${itemsCount}`;
}

export const portfolioI18n: Record<"en" | "zh-TW", Pick<AppDictionary, "recompute" | "transactions" | "holdings" | "feeProfiles"> & {
  tooltips: Pick<
    AppDictionary["tooltips"],
    | "recomputeTitle"
    | "recomputeLocale"
    | "recomputeCostBasis"
    | "recomputeQuotePoll"
    | "txAccount"
    | "txType"
    | "txSymbol"
    | "txQuantity"
    | "txPrice"
    | "txTradeDate"
    | "txDayTrade"
    | "holdingsAccount"
    | "holdingsSymbol"
    | "holdingsQuantity"
    | "holdingsTotalCost"
    | "feeProfileId"
    | "feeProfileName"
    | "feeProfileCommission"
    | "feeProfileTaxMode"
  >;
}> = {
  en: {
    recompute: {
      title: "Portfolio Engine",
      description: "Run historical recomputation after rule changes or profile updates.",
      localeTerm: "Locale",
      costBasisTerm: "Cost Basis",
      quotePollTerm: "Quote Poll",
      fallbackConfirm:
        "Recompute now using per-security overrides first, then each account fallback profile for unmatched symbols?",
    },
    transactions: {
      title: "Record Transaction",
      description: "Enter trade details and append to your historical ledger.",
      accountTerm: "Account",
      typeTerm: "Type",
      symbolTerm: "Symbol",
      quantityTerm: "Quantity",
      priceTerm: "Price (NTD)",
      tradeDateTerm: "Trade Date",
      dayTradeTerm: "Day Trade",
      typeBuy: "BUY",
      typeSell: "SELL",
      dayTradeYes: "Yes",
      dayTradeNo: "No",
    },
    holdings: {
      title: "Holdings",
      description: "Aggregated quantity and total cost by account and symbol.",
      entries: (count) => `${count} entries`,
      accountTerm: "Account",
      symbolTerm: "Symbol",
      quantityTerm: "Quantity",
      totalCostTerm: "Total Cost",
    },
    feeProfiles: {
      title: "Fee Profiles",
      description: "Reference fee/tax configurations attached to broker accounts.",
      idTerm: "ID",
      nameTerm: "Name",
      commissionBpsTerm: "Commission Bps",
      taxModeTerm: "Tax Mode",
    },
    tooltips: {
      recomputeTitle: "Reapplies portfolio calculations to historical transactions.",
      recomputeLocale: "Current UI language loaded from saved settings.",
      recomputeCostBasis: "Current lot matching method used for PnL and holdings.",
      recomputeQuotePoll: "Current quote polling frequency in seconds.",
      txAccount: "Broker account where this transaction should be recorded.",
      txType: "BUY increases lots; SELL reduces lots and realizes PnL.",
      txSymbol: "Taiwan stock or ETF ticker, for example 2330 or 0050.",
      txQuantity: "Share count for the trade; must be a positive integer.",
      txPrice: "Execution price per share in New Taiwan Dollar.",
      txTradeDate: "Trade settlement date used in portfolio history ordering.",
      txDayTrade: "Enable if buy and sell happen within the same day for tax rules.",
      holdingsAccount: "Broker account identifier where holdings are tracked.",
      holdingsSymbol: "Instrument ticker currently held in the account.",
      holdingsQuantity: "Open position size after historical transactions.",
      holdingsTotalCost: "Accumulated cost basis for remaining open quantity.",
      feeProfileId: "Stable profile ID referenced by accounts.",
      feeProfileName: "Human-readable broker fee profile name.",
      feeProfileCommission: "Commission rate in basis points before discounts/minimum.",
      feeProfileTaxMode: "Rounding strategy used when calculating taxes.",
    },
  },
  "zh-TW": {
    recompute: {
      title: "投資組合引擎",
      description: "規則或費率調整後，可重新計算歷史結果。",
      localeTerm: "語系",
      costBasisTerm: "成本計算",
      quotePollTerm: "報價更新",
      fallbackConfirm: "是否立即重算？系統會先套用代號覆寫，找不到時再使用帳戶預設費率。",
    },
    transactions: {
      title: "新增交易",
      description: "輸入交易資訊並寫入歷史帳本。",
      accountTerm: "帳戶",
      typeTerm: "交易類型",
      symbolTerm: "代號",
      quantityTerm: "股數",
      priceTerm: "成交價（新台幣）",
      tradeDateTerm: "交易日期",
      dayTradeTerm: "當沖",
      typeBuy: "買進",
      typeSell: "賣出",
      dayTradeYes: "是",
      dayTradeNo: "否",
    },
    holdings: {
      title: "持倉",
      description: "依帳戶與代號彙整持股數量與總成本。",
      entries: (count) => `${count} 筆`,
      accountTerm: "帳戶",
      symbolTerm: "代號",
      quantityTerm: "股數",
      totalCostTerm: "總成本",
    },
    feeProfiles: {
      title: "費率設定檔",
      description: "檢視各券商帳戶套用的手續費與稅率規則。",
      idTerm: "編號",
      nameTerm: "名稱",
      commissionBpsTerm: "手續費基點",
      taxModeTerm: "稅額進位",
    },
    tooltips: {
      recomputeTitle: "對歷史交易重新套用計算規則並回寫結果。",
      recomputeLocale: "目前介面語系，來自已儲存設定。",
      recomputeCostBasis: "目前使用的庫存配對方法。",
      recomputeQuotePoll: "目前報價更新頻率（秒）。",
      txAccount: "本筆交易將寫入的券商帳戶。",
      txType: "買進會增加庫存，賣出會減少庫存並計算已實現損益。",
      txSymbol: "台股或 ETF 代號，例如 2330、0050。",
      txQuantity: "本次交易的股數，需為正整數。",
      txPrice: "每股成交價格，單位為新台幣。",
      txTradeDate: "用於排序歷史與重算的交易日期。",
      txDayTrade: "若同日買賣請開啟，會套用當沖相關稅率。",
      holdingsAccount: "持倉所屬的券商帳戶識別碼。",
      holdingsSymbol: "目前仍持有部位的商品代號。",
      holdingsQuantity: "歷史交易後尚未平倉的數量。",
      holdingsTotalCost: "未平倉數量對應的總成本基礎。",
      feeProfileId: "供帳戶引用的固定費率設定檔編號。",
      feeProfileName: "費率設定檔的人類可讀名稱。",
      feeProfileCommission: "手續費率（基點），套用折扣與最低手續費前的基準值。",
      feeProfileTaxMode: "計算稅額時採用的進位/捨去規則。",
    },
  },
};
