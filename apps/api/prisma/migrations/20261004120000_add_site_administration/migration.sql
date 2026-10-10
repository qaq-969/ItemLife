ALTER TABLE `users`
  ADD COLUMN `site_role` ENUM('super_admin', 'admin', 'user') NOT NULL DEFAULT 'user',
  ADD COLUMN `disabled_at` DATETIME(3) NULL;

CREATE TABLE `site_settings` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `registration_open` BOOLEAN NOT NULL DEFAULT true,
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `site_settings` (`id`, `registration_open`, `updated_at`)
VALUES (1, true, CURRENT_TIMESTAMP(3));

CREATE TABLE `site_invites` (
  `id` BINARY(16) NOT NULL,
  `code_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_by` BINARY(16) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `site_invites_code_hash_key`(`code_hash`),
  INDEX `site_invites_created_by_idx`(`created_by`),
  INDEX `site_invites_expires_at_idx`(`expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `site_invites_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

UPDATE `users`
SET `site_role` = 'super_admin'
WHERE `id` = (
  SELECT `id` FROM (
    SELECT `id`
    FROM `users`
    WHERE `deleted_at` IS NULL
    ORDER BY `created_at` ASC, `id` ASC
    LIMIT 1
  ) AS `first_user`
);
