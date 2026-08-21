import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One row per reminder actually dispatched. This is the ledger the reminder
 * engine reads to enforce cooldown and per-dose attempt caps, and to prove
 * after the fact what was sent to whom — so it must be written only after a
 * send is attempted, never speculatively.
 *
 * `doseKey` identifies the specific dose the reminder is about
 * (`${vaccineCode}#${doseNumber}`) so a child due for two different doses can
 * still be reminded about each independently.
 */
const reminderLogSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    chin: { type: String, required: true },
    doseKey: { type: String, required: true },
    channel: { type: String, enum: ['sms'], default: 'sms' },
    to: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    providerName: { type: String, required: true },
    providerMessageId: { type: String, default: null },
    error: { type: String, default: null },
    sentAt: { type: Date, required: true }
  },
  { timestamps: true }
);

// The engine's hottest query: "how have we reminded this child about this dose?"
reminderLogSchema.index({ childId: 1, doseKey: 1, sentAt: -1 });

export type ReminderLogDoc = InferSchemaType<typeof reminderLogSchema>;
export const ReminderLogModel = model('ReminderLog', reminderLogSchema);
