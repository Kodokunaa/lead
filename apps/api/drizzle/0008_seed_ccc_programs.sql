-- City College of Calapan's degree programs (public reference data, from the college's career portal).
-- Administrators can add or deactivate programs later; existing rows are left alone.
INSERT INTO "programs" ("code", "name") VALUES
  ('BPA', 'Bachelor of Public Administration'),
  ('BSED Math', 'Bachelor of Secondary Education Major in Mathematics'),
  ('BSED Science', 'Bachelor of Secondary Education Major in Science'),
  ('BSHM', 'Bachelor of Science in Hospitality Management'),
  ('BSIS', 'Bachelor of Science in Information Systems'),
  ('BSNED', 'Bachelor of Special Needs Education'),
  ('BSTM', 'Bachelor of Science in Tourism Management')
ON CONFLICT (lower("code")) DO NOTHING;
