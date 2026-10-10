ALTER TABLE `transaction_items`
  ADD COLUMN `name` VARCHAR(100) NULL AFTER `parent_id`;
