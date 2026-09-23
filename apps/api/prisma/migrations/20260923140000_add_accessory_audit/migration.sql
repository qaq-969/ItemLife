-- AlterTable
ALTER TABLE `item_accessories` ADD COLUMN `purchased_at` DATE NOT NULL,
    ADD COLUMN `transaction_id` BINARY(16) NULL,
    MODIFY `name` VARCHAR(60) NOT NULL;

-- CreateTable
CREATE TABLE `accessory_usages` (
    `id` BINARY(16) NOT NULL,
    `accessory_id` BINARY(16) NOT NULL,
    `item_id` BINARY(16) NOT NULL,
    `delta_qty` INTEGER NOT NULL,
    `used_qty_after` INTEGER NOT NULL,
    `actor_user_id` BINARY(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `accessory_usages_accessory_id_created_at_idx`(`accessory_id`, `created_at`),
    INDEX `accessory_usages_item_id_created_at_idx`(`item_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `item_accessories` ADD CONSTRAINT `item_accessories_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accessory_usages` ADD CONSTRAINT `accessory_usages_accessory_id_fkey` FOREIGN KEY (`accessory_id`) REFERENCES `item_accessories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accessory_usages` ADD CONSTRAINT `accessory_usages_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accessory_usages` ADD CONSTRAINT `accessory_usages_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
