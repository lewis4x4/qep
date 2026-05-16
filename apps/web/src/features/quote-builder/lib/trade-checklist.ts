// Trade-in evidence checklist — shared between TradeInStep (PR 13) and the
// page-level trade-capture dialog.

export type TradeChecklistKey =
  | "hourMeter"
  | "undercarriage"
  | "hydraulicLeaks"
  | "serviceHours"
  | "tiresTracks"
  | "photos";

export type TradeCaptureDraft = Record<TradeChecklistKey, string>;

export const TRADE_CHECKLIST_ITEMS: Array<{
  key: TradeChecklistKey;
  label: string;
  prompt: string;
  placeholder: string;
}> = [
  { key: "hourMeter", label: "Hour meter captured", prompt: "Capture the hour meter reading or photo note.", placeholder: "e.g. 1,248 hours shown on meter; photo captured" },
  { key: "undercarriage", label: "Undercarriage / frame checked", prompt: "Record frame, undercarriage, rust, welds, or structural concerns.", placeholder: "e.g. Frame straight, no cracks; light wear on undercarriage" },
  { key: "hydraulicLeaks", label: "Hydraulic leaks checked", prompt: "Note whether leaks, seepage, hose issues, or cylinder concerns are visible.", placeholder: "e.g. No active leaks; left lift cylinder seepage noted" },
  { key: "serviceHours", label: "Engine hours / service noted", prompt: "Record service interval, last service, engine hours, or maintenance proof.", placeholder: "e.g. 250h service completed Jan 2026; oil sample pending" },
  { key: "tiresTracks", label: "Tires or tracks condition noted", prompt: "Capture tire/track tread, cuts, wear percentage, and replacement risk.", placeholder: "e.g. Rear tires 60%; front right has sidewall cut" },
  { key: "photos", label: "Visible damage photos captured", prompt: "List captured photo angles or visible damage evidence.", placeholder: "e.g. Front-left, rear-right, serial plate, bucket edge damage photos captured" },
];

export const EMPTY_TRADE_CAPTURE: TradeCaptureDraft = {
  hourMeter: "",
  undercarriage: "",
  hydraulicLeaks: "",
  serviceHours: "",
  tiresTracks: "",
  photos: "",
};
