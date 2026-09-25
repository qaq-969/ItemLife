ALTER TABLE `item_accessories` ADD COLUMN `reverted_qty` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `inventory_reverts` (
  `id` BINARY(16) NOT NULL,
  `item_id` BINARY(16) NOT NULL,
  `accessory_id` BINARY(16) NULL,
  `source_transaction_id` BINARY(16) NULL,
  `cash_transaction_id` BINARY(16) NULL,
  `kind` ENUM('dispose', 'correction', 'refund') NOT NULL,
  `qty` INTEGER NULL,
  `reason` VARCHAR(200) NOT NULL,
  `created_by` BINARY(16) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `inventory_reverts_item_id_created_at_idx` (`item_id`, `created_at`),
  INDEX `inventory_reverts_accessory_id_created_at_idx` (`accessory_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inventory_reverts`
  ADD CONSTRAINT `inventory_reverts_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_reverts_accessory_id_fkey` FOREIGN KEY (`accessory_id`) REFERENCES `item_accessories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_reverts_source_transaction_id_fkey` FOREIGN KEY (`source_transaction_id`) REFERENCES `transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_reverts_cash_transaction_id_fkey` FOREIGN KEY (`cash_transaction_id`) REFERENCES `transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_reverts_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
