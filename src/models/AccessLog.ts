import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Append-only audit trail of every record access at the verification terminal
 * (NCIHAP §17 audit trail, §24 immutable audit trails). One row per lookup:
 * who accessed which child's record, when, how (typed CHIN vs scanned QR), and
 * which disclosure tier they were shown. Never updated or deleted — the app
 * exposes no route to mutate it, only to append and to read.
 */
const accessLogSchema = new Schema(
  {
    chin: { type: String, required: true, index: true },
    childId: { type: Schema.Types.ObjectId, ref: 'Child', default: null },
    accessedBy: { type: String, required: true }, // staff username
    accessorRole: { type: String, enum: ['verifier', 'staff', 'admin'], required: true },
    method: { type: String, enum: ['chin', 'qr', 'api'], required: true },
    tier: { type: String, enum: ['verifier', 'staff', 'admin'], required: true },
    outcome: { type: String, enum: ['ok', 'not_found', 'denied'], required: true },
    at: { type: Date, required: true }
  },
  { timestamps: true }
);

accessLogSchema.index({ chin: 1, at: -1 });

export type AccessLogDoc = InferSchemaType<typeof accessLogSchema>;
export const AccessLogModel = model('AccessLog', accessLogSchema);
