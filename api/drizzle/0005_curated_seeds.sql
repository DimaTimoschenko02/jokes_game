-- Curated seed openings (admin-scored) and their reference jokes.
-- Mirrors api/scripts/import-seeds.ts but without embeddings (NULL).
-- Backfill embeddings later by running:  npm run -w api seed:import
-- (re-runs import-seeds.ts which does ON CONFLICT DO UPDATE).
--
-- Safe to apply on a populated DB: ON CONFLICT DO NOTHING skips existing rows.

-- ── 1. "после четвертой попытки трахнуть пылесос Дима" (10) ──
INSERT INTO prompt_starters (
  text, is_golden, is_seed,
  admin_score, admin_scored_by, admin_scored_at, admin_comment
) VALUES (
  'после четвертой попытки трахнуть пылесос Дима',
  true, true,
  10, 'Dima', NOW(),
  'неожиданно, смех над Димой'
) ON CONFLICT (text) DO NOTHING;

INSERT INTO joke_memory (
  prompt, punchline, prompt_normalized, fingerprint,
  quality_score, vote_share,
  admin_score, admin_scored_by, admin_scored_at, admin_comment,
  is_seed, author_real_name, source, room_code, round_index
) VALUES (
  'после четвертой попытки трахнуть пылесос Дима',
  'всё-таки вернулся к своей девушке',
  'после четвертой попытки трахнуть пылесос дима',
  'после четвертой попытки трахнуть пылесос дима::всё-таки вернулся к своей девушке',
  0.9, 0.9,
  9, 'Dima', NOW(), 'юмор с некой дискриминацией',
  true, 'Dima', 'human', 'SEED', 0
) ON CONFLICT (fingerprint) DO NOTHING;

INSERT INTO joke_memory (
  prompt, punchline, prompt_normalized, fingerprint,
  quality_score, vote_share,
  admin_score, admin_scored_by, admin_scored_at, admin_comment,
  is_seed, author_real_name, source, room_code, round_index
) VALUES (
  'после четвертой попытки трахнуть пылесос Дима',
  'смог попасть на шоу «тупые с маленькими членами»',
  'после четвертой попытки трахнуть пылесос дима',
  'после четвертой попытки трахнуть пылесос дима::смог попасть на шоу «тупые с маленькими членами»',
  0.5, 0.5,
  5, 'Dima', NOW(), 'не современно, всякие шоу уже никто не смотрит, особенно в нашем поколении',
  true, 'Dima', 'human', 'SEED', 0
) ON CONFLICT (fingerprint) DO NOTHING;

-- ── 2. "Богдан стал оператором FPV дронов чтобы" (9) ──
INSERT INTO prompt_starters (
  text, is_golden, is_seed,
  admin_score, admin_scored_by, admin_scored_at, admin_comment
) VALUES (
  'Богдан стал оператором FPV дронов чтобы',
  true, true,
  9, 'Dima', NOW(),
  'актуально и забавно в условиях текущей ситуации в Украине'
) ON CONFLICT (text) DO NOTHING;

INSERT INTO joke_memory (
  prompt, punchline, prompt_normalized, fingerprint,
  quality_score, vote_share,
  admin_score, admin_scored_by, admin_scored_at, admin_comment,
  is_seed, author_real_name, source, room_code, round_index
) VALUES (
  'Богдан стал оператором FPV дронов чтобы',
  'подглядывать за русскими малолетками',
  'богдан стал оператором fpv дронов чтобы',
  'богдан стал оператором fpv дронов чтобы::подглядывать за русскими малолетками',
  0.9, 0.9,
  9, 'Dima', NOW(), 'выставление Богдана в роли педофила-маньяка',
  true, 'Dima', 'human', 'SEED', 0
) ON CONFLICT (fingerprint) DO NOTHING;

INSERT INTO joke_memory (
  prompt, punchline, prompt_normalized, fingerprint,
  quality_score, vote_share,
  admin_score, admin_scored_by, admin_scored_at, admin_comment,
  is_seed, author_real_name, source, room_code, round_index
) VALUES (
  'Богдан стал оператором FPV дронов чтобы',
  'побеждать в войне',
  'богдан стал оператором fpv дронов чтобы',
  'богдан стал оператором fpv дронов чтобы::побеждать в войне',
  0.5, 0.5,
  5, 'Dima', NOW(), 'это приятно слышать, но это не смешно и банально, предсказуемо',
  true, 'Dima', 'human', 'SEED', 0
) ON CONFLICT (fingerprint) DO NOTHING;

-- ── 3. "после застолья не придумав ничего более Олег пошёл заниматься спортом в" (5) ──
INSERT INTO prompt_starters (
  text, is_golden, is_seed,
  admin_score, admin_scored_by, admin_scored_at, admin_comment
) VALUES (
  'после застолья не придумав ничего более Олег пошёл заниматься спортом в',
  false, true,
  5, 'Dima', NOW(),
  'длинно, урезаны разветвления — лучше было бы закончить на "Олег пошёл", тогда оценка была бы 7-8'
) ON CONFLICT (text) DO NOTHING;

INSERT INTO joke_memory (
  prompt, punchline, prompt_normalized, fingerprint,
  quality_score, vote_share,
  admin_score, admin_scored_by, admin_scored_at, admin_comment,
  is_seed, author_real_name, source, room_code, round_index
) VALUES (
  'после застолья не придумав ничего более Олег пошёл заниматься спортом в',
  'стрипуху',
  'после застолья не придумав ничего более олег пошёл заниматься спортом в',
  'после застолья не придумав ничего более олег пошёл заниматься спортом в::стрипуху',
  0.7, 0.7,
  7, 'Dima', NOW(), 'хорошее короткое завершение длинной шутки, но можно было бы добавить абсурда или неожиданности',
  true, 'Dima', 'human', 'SEED', 0
) ON CONFLICT (fingerprint) DO NOTHING;

INSERT INTO joke_memory (
  prompt, punchline, prompt_normalized, fingerprint,
  quality_score, vote_share,
  admin_score, admin_scored_by, admin_scored_at, admin_comment,
  is_seed, author_real_name, source, room_code, round_index
) VALUES (
  'после застолья не придумав ничего более Олег пошёл заниматься спортом в',
  'зал, где уже были его собутыльники',
  'после застолья не придумав ничего более олег пошёл заниматься спортом в',
  'после застолья не придумав ничего более олег пошёл заниматься спортом в::зал, где уже были его собутыльники',
  0.3, 0.3,
  3, 'Dima', NOW(), 'а в чём тут шутка вообще?',
  true, 'Dima', 'human', 'SEED', 0
) ON CONFLICT (fingerprint) DO NOTHING;

-- ── 4. "после того как колобок повесился, Тася взяла его и" (4) ──
INSERT INTO prompt_starters (
  text, is_golden, is_seed,
  admin_score, admin_scored_by, admin_scored_at, admin_comment
) VALUES (
  'после того как колобок повесился, Тася взяла его и',
  false, true,
  4, 'Dima', NOW(),
  'про колобка уже старая шутка, всё было бы не так плохо если бы в конце не было ограничения "Тася взяла его и" — очень сужает продолжение и так заезженой шутки'
) ON CONFLICT (text) DO NOTHING;

INSERT INTO joke_memory (
  prompt, punchline, prompt_normalized, fingerprint,
  quality_score, vote_share,
  admin_score, admin_scored_by, admin_scored_at, admin_comment,
  is_seed, author_real_name, source, room_code, round_index
) VALUES (
  'после того как колобок повесился, Тася взяла его и',
  'продолжила использовать как анальный шарик',
  'после того как колобок повесился, тася взяла его и',
  'после того как колобок повесился, тася взяла его и::продолжила использовать как анальный шарик',
  0.8, 0.8,
  8, 'Dima', NOW(), 'абсурдно и неожиданно, довольно хорошее продолжение для плохого старта',
  true, 'Dima', 'human', 'SEED', 0
) ON CONFLICT (fingerprint) DO NOTHING;
