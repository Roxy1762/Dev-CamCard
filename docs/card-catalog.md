# 卡牌 ID 冻结表（首发 Core Set）

> 本文件用于“先冻结 ID，再开发”。后续代码、测试、数据库引用均以此为准。

## 起始套牌（12）

- starter_allowance
- starter_quarrel
- starter_draft_paper
- starter_punctuality

## 固定补给（3）

- supply_errand_runner
- supply_milk_bread
- supply_print_materials

## 状态牌（1）

- status_pressure

## 红（体育部）

- red_sprint_start
- red_pre_match_warmup
- red_cheer_combo
- red_extra_training_plan
- red_gym_booking
- red_finals_day

## 蓝（学研组）

- blue_class_notes
- blue_draft_simulation
- blue_mock_exam
- blue_mistake_book
- blue_study_room_seat
- blue_all_night_study

## 白（风纪部）

- white_discipline_patrol
- white_discipline_warning
- white_dorm_inspection
- white_duty_student
- white_student_affairs_talk
- white_discipline_week

## 绿（社团联）

- green_recruiting_flyer
- green_used_book_recycle
- green_find_sponsorship
- green_planning_meeting
- green_makerspace
- green_anniversary_sponsor

## 中立工具

- neutral_convenience_snack
- neutral_class_representative_notice
- neutral_library_closing
- neutral_seat_swap
- neutral_campus_broadcast
- neutral_finals_week

## 说明

- 本轮先冻结 ID，不在此文件中展开全文卡面。
- 完整卡面文案后续放在 `data/cards/*.json`，但不得改动既有 ID。

## 与自动生成目录的关系

- `docs/card-catalog.generated.md` 是自动生成文件：由 `data/cards/rules/*.json`（规则真源）和 `data/cards/text/zh-CN/*.json`（中文文案）合并生成。
- 本文件（`docs/card-catalog.md`）继续作为“ID 冻结与人工说明”文档，不承载完整卡面字段展开。
- 当规则数据或中文文案变更时，执行 `pnpm generate:card-catalog` 更新 generated 文件，避免文档与数据漂移。
