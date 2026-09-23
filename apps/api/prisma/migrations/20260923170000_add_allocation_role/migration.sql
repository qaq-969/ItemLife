-- AlterTable：历史分摊一律回填 link（不进成本口径），保证旧数据成本数字不变
ALTER TABLE `transaction_items` ADD COLUMN `role` ENUM('body', 'fee', 'accessory', 'link') NOT NULL DEFAULT 'link',
    ADD COLUMN `accessory_id` BINARY(16) NULL;

-- AlterTable
ALTER TABLE `items` ADD COLUMN `purchase_transaction_id` BINARY(16) NULL;

-- CreateIndex
CREATE INDEX `transaction_items_accessory_id_idx` ON `transaction_items`(`accessory_id`);

-- AddForeignKey
ALTER TABLE `transaction_items` ADD CONSTRAINT `transaction_items_accessory_id_fkey` FOREIGN KEY (`accessory_id`) REFERENCES `item_accessories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_purchase_transaction_id_fkey` FOREIGN KEY (`purchase_transaction_id`) REFERENCES `transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
