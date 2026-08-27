import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * An antenatal registration (NCIHAP §19, extended): the record opened when a
 * woman is registered at antenatal care, before the child is born.
 *
 * WHY THIS EXISTS — the evidence:
 *
 * Antenatal contact is one of the strongest available predictors of whether a
 * child will ever be vaccinated. Across six Nigerian states (n=1,958), children
 * whose mothers had fewer than four ANC visits were zero-dose 35.0% of the
 * time, against 17.1% for four or more (p=0.017); home delivery 35.4% against
 * 16.7% for facility delivery (p<0.001). Across 92 low- and middle-income
 * countries (n=211,141 children), mothers of zero-dose children were 51% less
 * likely to have had 4+ ANC visits and 47% less likely to have delivered in a
 * facility.
 *
 * The mechanism is the one this whole system is built around: ANC is where the
 * next contact gets SCHEDULED, and facility delivery is where the birth dose is
 * actually given. Miss the delivery, miss the birth dose; miss the birth dose
 * and the child has no record, no card, and no scheduled next contact.
 *
 * So the registry opens the record at the last reliable touchpoint BEFORE the
 * gap, rather than after it. Two things follow that were previously impossible:
 * the caregiver's phone is captured while she is still in contact with the
 * system (which is what the USSD channel keys on), and a record is already
 * waiting when the birth dose is given.
 *
 * IMPORTANT — this is an ADDITIONAL channel, never the primary one. Around 37%
 * of Nigerian women attend no ANC at all, and they are disproportionately the
 * rural, poor, north-western and north-eastern families this programme exists
 * for. The 92-country analysis is explicit that the same households miss BOTH
 * services, so ANC registration must sit alongside the CHW, home-birth, mobile
 * team and outreach channels in §19 — it cannot replace them.
 *
 * A pregnancy is NOT a child: this carries its own `ancId` namespace and only
 * becomes a Child (with a CHIN) when a live birth is recorded against it.
 */
const ancVisitSchema = new Schema(
  {
    visitNumber: { type: Number, required: true },
    date: { type: Date, required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null }
  },
  { _id: false }
);

const pregnancySchema = new Schema(
  {
    ancId: { type: String, required: true, unique: true, index: true },
    // The expectant mother / caregiver. Reuses the Caregiver record precisely so
    // the phone number captured here is the one the reminder engine and the
    // USSD channel already use — no second contact list to keep in step.
    caregiverId: { type: Schema.Types.ObjectId, ref: 'Caregiver', required: true },
    // Where antenatal care is being received; becomes the child's home facility
    // on linking, unless the birth is recorded elsewhere.
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    expectedDeliveryDate: { type: Date, required: true },
    // WHO's 2016 ANC model recommends a minimum of EIGHT contacts (up from
    // four). Pooled adherence across LMICs is about 13%, so the count matters
    // far more as a risk signal than as a compliance measure.
    visits: { type: [ancVisitSchema], default: [] },
    status: {
      type: String,
      enum: ['active', 'linked', 'closed'],
      default: 'active',
      index: true
    },
    // Set when a live birth is recorded — the pregnancy becomes a child record.
    linkedChildId: { type: Schema.Types.ObjectId, ref: 'Child', default: null },
    linkedChin: { type: String, default: null },
    linkedAt: { type: Date, default: null },
    // Closed without a linked child. 'not_a_live_birth' exists so that a loss is
    // recorded once, quietly, and the record stops generating follow-up work —
    // never left 'active' to sit in a queue chasing a birth that will not come.
    closedReason: {
      type: String,
      enum: ['not_a_live_birth', 'moved_away', 'lost_to_followup', 'other', null],
      default: null
    },
    closedAt: { type: Date, default: null },
    registeredBy: { type: String, default: '' }
  },
  { timestamps: true }
);

export type PregnancyDoc = InferSchemaType<typeof pregnancySchema>;
export const PregnancyModel = model('Pregnancy', pregnancySchema);
