ALTER TABLE `household_members`
  MODIFY `role` ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member';
