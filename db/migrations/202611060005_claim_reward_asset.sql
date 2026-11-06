-- Preserve historical claims without guessing their reward asset.
-- Settlement writers must record the mint and decimals verified from the actual transfer.
alter table pfl_claims add column reward_mint text;
alter table pfl_claims add column reward_decimals smallint;
alter table pfl_claims add constraint pfl_claim_reward_asset check (
 (reward_mint is null and reward_decimals is null) or
 (reward_mint is not null and reward_decimals is not null and reward_decimals between 0 and 18)
);
