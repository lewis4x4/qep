import {
  RENTAL_ASSESSMENT_FIELDS,
  type RentalAnswer,
  rentalAssessmentMissing,
  type RentalNeedsAssessment,
} from "../../../../../../shared/rental-needs-assessment";
import { Input } from "@/components/ui/input";

export function RentalInquiryAssessment(
  { value, onChange }: {
    value: RentalNeedsAssessment;
    onChange: (next: RentalNeedsAssessment) => void;
  },
) {
  function setAnswer(key: string, patch: Partial<RentalAnswer>) {
    onChange({
      ...value,
      reviewed: false,
      answers: {
        ...value.answers,
        [key]: {
          ...(value.answers[key] ?? { status: "answered", value: "" }),
          ...patch,
        },
      },
    });
  }
  const missing = rentalAssessmentMissing(value);
  const choices: Record<string, Array<[string, string]>> = {
    delivery: [["delivery", "QEP delivery"], [
      "self_haul",
      "Customer self-haul",
    ]],
    pickup: [["qep_pickup", "QEP pickup at return"], [
      "self_haul",
      "Customer returns unit",
    ]],
    insurance: [["ldw", "Purchase LDW"], ["coi", "Provide COI"]],
    payment_method: [["check", "Check"], ["wire", "Wire transfer"], [
      "credit_card",
      "Credit card",
    ], ["charge_account", "Charge account"]],
  };
  return (
    <section className="mt-4 space-y-3" aria-label="Rental needs assessment">
      <p className="text-sm">
        Ask the customer to describe the job before suggesting equipment. Record
        each answer, or explicitly mark it unknown or not applicable. Confirm
        equipment, duration and delivery before discussing price.
      </p>
      {["Equipment", "Timeline", "Job site", "Logistics", "Customer"].map((
        category,
      ) => (
        <details
          key={category}
          open={category === "Equipment"}
          className="rounded border p-3"
        >
          <summary className="cursor-pointer font-medium">{category}</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {RENTAL_ASSESSMENT_FIELDS.filter(([, c]) => c === category).map((
              [key, , label],
            ) => (
              <div key={key} className="space-y-1">
                <label
                  htmlFor={`rental-answer-${key}`}
                  className="block text-xs font-medium"
                >
                  {label}
                </label>
                <select
                  aria-label={`${label} answer status`}
                  value={value.answers[key]?.status ?? ""}
                  onChange={(e) =>
                    setAnswer(key, {
                      status: e.target.value as RentalAnswer["status"],
                    })}
                  className="w-full rounded border bg-background p-2 text-sm"
                >
                  <option value="" disabled>Not yet asked</option>
                  <option value="answered">Answered</option>
                  <option value="unknown">Asked, unknown</option>
                  <option value="not_applicable">Not applicable</option>
                </select>
                {choices[key]
                  ? (
                    <select
                      id={`rental-answer-${key}`}
                      value={value.answers[key]?.value ?? ""}
                      onChange={(e) =>
                        setAnswer(key, {
                          status: "answered",
                          value: e.target.value,
                        })}
                      className="w-full rounded border bg-background p-2 text-sm"
                    >
                      <option value="">Confirm choice</option>
                      {choices[key].map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  )
                  : (
                    <Input
                      id={`rental-answer-${key}`}
                      value={value.answers[key]?.value ?? ""}
                      type={key === "desired_start_date" ||
                          key === "desired_return_date"
                        ? "date"
                        : "text"}
                      onChange={(e) =>
                        setAnswer(key, { value: e.target.value })}
                      placeholder={key === "insurance"
                        ? "LDW or COI"
                        : "Customer answer or context"}
                    />
                  )}
              </div>
            ))}
          </div>
        </details>
      ))}
      <label className="block text-xs font-medium">
        Conversation / voice transcript
        <textarea
          className="mt-1 w-full rounded border bg-background p-2"
          value={value.narrative}
          onChange={(e) =>
            onChange({ ...value, narrative: e.target.value, reviewed: false })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.return_date_confirmed}
          onChange={(e) =>
            onChange({ ...value, return_date_confirmed: e.target.checked })}
        />Customer confirmed the return date for booking
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.reviewed}
          onChange={(e) =>
            onChange({ ...value, reviewed: e.target.checked })}
        />I reviewed all five categories with the customer
      </label>
      <p role="status" className="text-xs text-muted-foreground">
        {missing.length
          ? `Before quoting: ${missing.join("; ")}`
          : "Assessment ready for quote. Save changes before issuing."}
      </p>
    </section>
  );
}
