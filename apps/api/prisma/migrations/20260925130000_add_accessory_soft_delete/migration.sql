ALTER TABLE `item_accessories`
  ADD COLUMN `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

CREATE INDEX `item_accessories_item_id_deleted_at_idx`
  ON `item_accessories`(`item_id`, `deleted_at`);
