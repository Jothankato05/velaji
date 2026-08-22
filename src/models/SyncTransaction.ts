import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * The server-side ledger of every offline transaction a device has pushed
 * (NCIHAP §9). Its whole job is idempotency + audit: a flaky network means the
 * same transaction may arrive two or three times, and `clientTxId` (a
 * device-generated id) is unique, so a replay is recognised and never
 * double-applied. Also records how each transaction was resolved, so a sync
 * conflict has a paper trail.
 */
const syncTransactionSchema = new Schema(
  {
    clientTxId: { type: String, required: true, unique: true, index: true },
    deviceId: { type: String, default: '' },
    // No enum: this is an audit ledger of whatever a device sent, so an
    // unrecognised type is still recorded (with result 'error') rather than
    // rejected at save time.
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    // When the event actually happened on the device (may be well before it
    // reaches the server), vs when the server received it.
    recordedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    result: { type: String, enum: ['applied', 'duplicate', 'conflict', 'error'], required: true },
    appliedBy: { type: String, default: '' },
    chin: { type: String, default: '' },
    detail: { type: String, default: '' }
  },
  { timestamps: true }
);

export type SyncTransactionDoc = InferSchemaType<typeof syncTransactionSchema>;
export const SyncTransactionModel = model('SyncTransaction', syncTransactionSchema);
