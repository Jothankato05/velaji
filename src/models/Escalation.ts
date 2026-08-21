import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * A child+dose the reminder engine has given up texting and handed to a human
 * to trace. Two reasons raise one:
 *   - 'max_attempts'      — caregiver ignored the reminder cap; SMS isn't working
 *   - 'lost_to_followup'  — dose is severely overdue (GREY); needs active tracing
 *
 * A partial unique index enforces at most ONE open escalation per child+dose,
 * so the engine can re-assert it every cycle (upsert) without piling up
 * duplicates. Resolved escalations stay as history.
 */
const escalationSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    chin: { type: String, required: true },
    doseKey: { type: String, required: true },
    reason: { type: String, enum: ['max_attempts', 'lost_to_followup'], required: true },
    remindersSent: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
    raisedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null },
    outcome: {
      type: String,
      enum: ['immunized', 'reached', 'moved_away', 'unreachable', 'other', null],
      default: null
    },
    resolutionNote: { type: String, default: '' }
  },
  { timestamps: true }
);

// At most one OPEN escalation per child+dose; resolved ones are unconstrained history.
escalationSchema.index({ childId: 1, doseKey: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });

export type EscalationDoc = InferSchemaType<typeof escalationSchema>;
export const EscalationModel = model('Escalation', escalationSchema);
