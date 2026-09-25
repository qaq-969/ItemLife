ALTER TABLE `transaction_items`
  DROP INDEX `transaction_items_transaction_id_item_id_key`,
  ADD COLUMN `parent_id` BINARY(16) NULL,
  ADD INDEX `transaction_items_parent_id_idx` (`parent_id`),
  ADD UNIQUE INDEX `transaction_items_transaction_id_item_id_role_accessory_id_key` (`transaction_id`, `item_id`, `role`, `accessory_id`);

ALTER TABLE `items`
  ADD COLUMN `parent_item_id` BINARY(16) NULL,
  ADD INDEX `items_parent_item_id_idx` (`parent_item_id`);

ALTER TABLE `transaction_items`
  ADD CONSTRAINT `transaction_items_parent_id_fkey`
  FOREIGN KEY (`parent_id`) REFERENCES `transaction_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `items`
  ADD CONSTRAINT `items_parent_item_id_fkey`
  FOREIGN KEY (`parent_item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
