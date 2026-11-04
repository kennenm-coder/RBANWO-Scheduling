"use client";

import { useData } from "./DataProvider";
import MergeConfirmModal from "./MergeConfirmModal";

/**
 * Single mount point for the merge review modal, so a suggested pair can be
 * reviewed from anywhere (the queue, an Approve click on the calendar, the
 * Issues page) through useData().reviewMerge(candidate).
 */
export default function MergeReviewHost() {
  const { mergeReview, reviewMerge, mergeRForce, rejectMatch } = useData();
  if (!mergeReview) return null;
  const { appointment, rforceOrder } = mergeReview;
  return (
    <MergeConfirmModal
      key={`${appointment.id}|${rforceOrder.work_order_number}`}
      appointment={appointment}
      rforceOrder={rforceOrder}
      fuzzyMatch={mergeReview}
      onConfirm={async (choices) => {
        await mergeRForce(appointment, rforceOrder, choices);
      }}
      onReject={() => {
        if (rforceOrder.work_order_number) {
          void rejectMatch(appointment.id, rforceOrder.work_order_number);
        }
      }}
      onClose={() => reviewMerge(null)}
    />
  );
}
