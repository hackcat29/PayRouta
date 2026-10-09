-- Per-merchant, per-platform balance reads (payouts, refunds, disputes,
-- set-off, reconciliation) run inside serializable transactions. Without
-- these indexes they scan whole journal tables, which takes table-wide
-- predicate locks and makes unrelated merchants' payments conflict.
CREATE INDEX "JournalPosting_entryId_idx" ON "JournalPosting"("entryId");
CREATE INDEX "JournalEntry_orgId_environment_book_platformAccountId_asset_idx" ON "JournalEntry"("orgId",environment,book,"platformAccountId",asset);
