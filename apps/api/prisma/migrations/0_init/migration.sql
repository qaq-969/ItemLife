-- CreateTable
CREATE TABLE `users` (
    `id` BINARY(16) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `nickname` VARCHAR(50) NULL,
    `base_currency` CHAR(3) NOT NULL DEFAULT 'CNY',
    `mfa_enabled` BOOLEAN NOT NULL DEFAULT false,
    `totp_secret_enc` VARBINARY(512) NULL,
    `totp_confirmed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` BINARY(16) NOT NULL,
    `user_id` BINARY(16) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `device_name` VARCHAR(100) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `rotated_from` BINARY(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_expires_at_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mfa_recovery_codes` (
    `id` BINARY(16) NOT NULL,
    `user_id` BINARY(16) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mfa_recovery_codes_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `households` (
    `id` BINARY(16) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `owner_user_id` BINARY(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `household_members` (
    `id` BINARY(16) NOT NULL,
    `household_id` BINARY(16) NOT NULL,
    `user_id` BINARY(16) NOT NULL,
    `role` ENUM('owner', 'member') NOT NULL DEFAULT 'member',
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `household_members_user_id_idx`(`user_id`),
    UNIQUE INDEX `household_members_household_id_user_id_key`(`household_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `household_invites` (
    `id` BINARY(16) NOT NULL,
    `household_id` BINARY(16) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `max_uses` INTEGER NOT NULL DEFAULT 5,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `created_by` BINARY(16) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `household_invites_code_hash_key`(`code_hash`),
    INDEX `household_invites_household_id_idx`(`household_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounts` (
    `id` BINARY(16) NOT NULL,
    `owner_type` ENUM('user', 'household') NOT NULL,
    `owner_id` BINARY(16) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `type` ENUM('cash', 'bank', 'payment', 'investment', 'receivable', 'payable') NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
    `initial_balance_minor` BIGINT NOT NULL DEFAULT 0,
    `interest_rate_bp` INTEGER NULL,
    `interest_freq` ENUM('monthly', 'quarterly', 'yearly') NULL,
    `interest_posted_at` DATE NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `accounts_owner_type_owner_id_sort_order_idx`(`owner_type`, `owner_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` BINARY(16) NOT NULL,
    `owner_type` ENUM('user', 'household') NOT NULL,
    `owner_id` BINARY(16) NOT NULL,
    `kind` ENUM('income', 'expense') NOT NULL,
    `name` VARCHAR(30) NOT NULL,
    `icon` VARCHAR(50) NULL,
    `color` CHAR(7) NULL,
    `parent_id` BINARY(16) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `system_tag` VARCHAR(30) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `categories_owner_type_owner_id_kind_sort_order_idx`(`owner_type`, `owner_id`, `kind`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `id` BINARY(16) NOT NULL,
    `owner_type` ENUM('user', 'household') NOT NULL,
    `owner_id` BINARY(16) NOT NULL,
    `type` ENUM('income', 'expense', 'transfer_in', 'transfer_out') NOT NULL,
    `amount_minor` BIGINT NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
    `account_id` BINARY(16) NOT NULL,
    `category_id` BINARY(16) NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `note` VARCHAR(200) NULL,
    `system_tag` VARCHAR(30) NULL,
    `transfer_group_id` BINARY(16) NULL,
    `created_by` BINARY(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transactions_owner_type_owner_id_occurred_at_idx`(`owner_type`, `owner_id`, `occurred_at`),
    INDEX `transactions_account_id_type_amount_minor_idx`(`account_id`, `type`, `amount_minor`),
    INDEX `transactions_category_id_occurred_at_idx`(`category_id`, `occurred_at`),
    INDEX `transactions_transfer_group_id_idx`(`transfer_group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transaction_items` (
    `id` BINARY(16) NOT NULL,
    `transaction_id` BINARY(16) NOT NULL,
    `item_id` BINARY(16) NOT NULL,
    `amount_minor` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `transaction_items_item_id_created_at_idx`(`item_id`, `created_at`),
    UNIQUE INDEX `transaction_items_transaction_id_item_id_key`(`transaction_id`, `item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `items` (
    `id` BINARY(16) NOT NULL,
    `owner_type` ENUM('user', 'household') NOT NULL,
    `owner_id` BINARY(16) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `category_id` BINARY(16) NULL,
    `purchase_date` DATE NOT NULL,
    `purchase_price_minor` BIGINT NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
    `expected_lifespan_days` INTEGER NULL,
    `status` ENUM('in_use', 'idle', 'retired', 'lost') NOT NULL DEFAULT 'in_use',
    `note` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `items_owner_type_owner_id_status_idx`(`owner_type`, `owner_id`, `status`),
    INDEX `items_category_id_idx`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `item_accessories` (
    `id` BINARY(16) NOT NULL,
    `item_id` BINARY(16) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `unit_price_minor` BIGINT NOT NULL,
    `total_qty` INTEGER NOT NULL,
    `used_qty` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `item_accessories_item_id_idx`(`item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exchange_rates` (
    `id` BINARY(16) NOT NULL,
    `from_currency` CHAR(3) NOT NULL,
    `to_currency` CHAR(3) NOT NULL,
    `rate` DECIMAL(18, 8) NOT NULL,
    `effective_date` DATE NOT NULL,
    `source` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `exchange_rates_from_currency_to_currency_effective_date_key`(`from_currency`, `to_currency`, `effective_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mfa_recovery_codes` ADD CONSTRAINT `mfa_recovery_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `households` ADD CONSTRAINT `households_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_members` ADD CONSTRAINT `household_members_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_members` ADD CONSTRAINT `household_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_invites` ADD CONSTRAINT `household_invites_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_invites` ADD CONSTRAINT `household_invites_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_items` ADD CONSTRAINT `transaction_items_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_items` ADD CONSTRAINT `transaction_items_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_accessories` ADD CONSTRAINT `item_accessories_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

