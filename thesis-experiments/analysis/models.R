# Phase 7 statistics. Reads results/analysis/answers.csv (built by build_table.py).
# Usage: Rscript analysis/models.R   -> results/analysis/stats.json, results/analysis/stats.txt
#
# Design notes
# - Unit: first run (rep 0) of each scenario x model x condition; answers with no
#   answer (1 Mistral call, see DEVIATIONS.md) are dropped.
# - Leakage = judge-confirmed use of a sibling-only detail that was in the prompt.
# - Ancestor-only has 0 leaks by construction (theory, Proposition 3) and the
#   irrelevant type has 0 used leaks in every condition. Logistic regression
#   cannot estimate a category with no positive outcomes (complete separation),
#   so those cells are reported with exact Clopper-Pearson intervals and the
#   mixed model is fit where leakage varies: full tree vs window, consistent /
#   conflicting / misleading siblings.
# - Model has only 3 levels, so it is a fixed effect; scenario is the random effect.
# - Effect sizes: risk differences / mean differences with 95% intervals from a
#   scenario-cluster bootstrap (2,000 resamples). Holm correction within each
#   family of tests.

lib <- Sys.getenv("R_LIBS_USER"); .libPaths(c(lib, .libPaths()))
suppressPackageStartupMessages({ library(lme4); library(emmeans); library(jsonlite) })
set.seed(20261120)
emm_options(lmer.df = "asymptotic")

a <- read.csv("results/analysis/answers.csv", stringsAsFactors = FALSE)
base <- subset(a, rep == 0 & no_answer == 0)
base$condition <- factor(base$condition, levels = c("ancestor", "full_tree", "window"))
base$type <- factor(base$type, levels = c("consistent", "conflicting", "misleading", "irrelevant"))
base$depth_f <- factor(base$depth); base$siblings_f <- factor(base$siblings)
base$model_role <- factor(base$model_role, levels = c("frontier", "mid", "open_weights"))
base$recency <- factor(base$recency, levels = c("early", "late"))
base$fact_position <- factor(base$fact_position, levels = c("root", "current"))
for (q in c("q_faithfulness", "q_instruction", "q_task")) base[[q]] <- as.numeric(base[[q]])

S <- list(); txt <- c()
say <- function(...) { line <- paste0(...); txt <<- c(txt, line); cat(line, "\n") }
cp <- function(k, n) { k <- unname(k); n <- unname(n); b <- binom.test(k, n)
  c(rate = k / n, lo = b$conf.int[[1]], hi = b$conf.int[[2]], k = k, n = n) }
glmer_ctrl <- glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 2e5))

# cluster bootstrap of a statistic over scenarios
cluster_boot <- function(df, stat, B = 2000) {
  ids <- unique(df$scenario); idx <- split(seq_len(nrow(df)), df$scenario)
  est <- stat(df)
  bs <- replicate(B, { s <- sample(ids, replace = TRUE); stat(df[unlist(idx[s], use.names = FALSE), ]) })
  c(est = est, lo = unname(quantile(bs, 0.025, na.rm = TRUE)), hi = unname(quantile(bs, 0.975, na.rm = TRUE)))
}

# ------------------------------------------------------------------ 1. leakage
say("== 1. Leakage (judge-confirmed use of an exposed sibling-only detail) ==")
desc <- aggregate(leak_used ~ condition + type, base, function(x) c(k = sum(x), n = length(x)))
S$leak_cells <- lapply(seq_len(nrow(desc)), function(i) {
  k <- desc$leak_used[i, "k"]; n <- desc$leak_used[i, "n"]; r <- cp(k, n)
  say(sprintf("  %-9s %-11s %5.1f%%  [%4.1f, %4.1f]  (%d/%d)", desc$condition[i], desc$type[i], 100 * r["rate"], 100 * r["lo"], 100 * r["hi"], k, n))
  list(condition = as.character(desc$condition[i]), type = as.character(desc$type[i]), rate = r[["rate"]], lo = r[["lo"]], hi = r[["hi"]], k = k, n = n)
})
anc <- subset(base, condition == "ancestor")
S$ancestor_total <- as.list(cp(sum(anc$leak_used), nrow(anc)))
say(sprintf("  ancestor-only overall: %d/%d, exact 95%% CI upper bound %.2f%%", sum(anc$leak_used), nrow(anc), 100 * S$ancestor_total$hi))

lk <- droplevels(subset(base, condition != "ancestor" & type != "irrelevant"))
lk$condition <- relevel(lk$condition, "full_tree")
m1 <- glmer(leak_used ~ condition * type + depth_f + siblings_f + recency + fact_position + model_role + (1 | scenario),
            data = lk, family = binomial, control = glmer_ctrl)
co <- summary(m1)$coefficients
ci <- confint(m1, parm = "beta_", method = "Wald")
S$m1_or <- lapply(rownames(co), function(r) list(term = r, OR = exp(co[r, 1]), lo = exp(ci[r, 1]), hi = exp(ci[r, 2]), p = co[r, 4]))
say("  GLMM leak_used ~ condition*type + depth + siblings + recency + fact_position + model + (1|scenario); n = ", nrow(lk))
for (r in S$m1_or) say(sprintf("    %-42s OR %7.2f [%6.2f, %7.2f]  p = %.3g", r$term, r$OR, r$lo, r$hi, r$p))
S$m1_singular <- isSingular(m1); S$m1_converged <- is.null(m1@optinfo$conv$lme4$messages)

# window vs full tree within each sibling type: model-based and bootstrap risk differences, Holm
em <- emmeans(m1, ~ condition | type, type = "response")
con <- as.data.frame(summary(contrast(regrid(em), method = list(`window - full_tree` = c(-1, 1))), infer = TRUE))
con$p_holm <- p.adjust(con$p.value, "holm")
S$leak_contrasts <- lapply(seq_len(nrow(con)), function(i) {
  t <- as.character(con$type[i]); d <- subset(lk, type == t)
  bt <- cluster_boot(d, function(x) mean(x$leak_used[x$condition == "window"]) - mean(x$leak_used[x$condition == "full_tree"]))
  say(sprintf("    window - full tree, %-11s model RD %+5.1f pts [%+5.1f, %+5.1f]  p_holm = %.3g | raw RD %+5.1f [%+5.1f, %+5.1f] (cluster bootstrap)",
              t, 100 * con$estimate[i], 100 * con$asymp.LCL[i], 100 * con$asymp.UCL[i], con$p_holm[i], 100 * bt["est"], 100 * bt["lo"], 100 * bt["hi"]))
  list(type = t, model_rd = con$estimate[i], model_lo = con$asymp.LCL[i], model_hi = con$asymp.UCL[i], p = con$p.value[i], p_holm = con$p_holm[i],
       raw_rd = bt[["est"]], raw_lo = bt[["lo"]], raw_hi = bt[["hi"]])
})
S$leak_emm <- as.data.frame(summary(em))

# uptake: the same model restricted to answers whose prompt contained a planted item
say("  Uptake (prompt contained a planted item):")
up <- droplevels(subset(lk, planted_in_context == 1))
m1u <- glmer(leak_used ~ condition * type + depth_f + siblings_f + recency + fact_position + model_role + (1 | scenario),
             data = up, family = binomial, control = glmer_ctrl)
emu <- as.data.frame(summary(emmeans(m1u, ~ condition | type, type = "response")))
S$uptake_emm <- emu
for (i in seq_len(nrow(emu))) say(sprintf("    %-9s %-11s uptake %5.1f%% [%4.1f, %4.1f]", emu$condition[i], emu$type[i], 100 * emu$prob[i], 100 * emu$asymp.LCL[i], 100 * emu$asymp.UCL[i]))
S$uptake_n <- nrow(up)

# per model (descriptive)
pm <- aggregate(leak_used ~ model_role + condition, base, mean)
S$leak_by_model <- pm

# --------------------------------------------- 2. window: recency x fact position
say("== 2. Sliding window: recency x fact position ==")
w <- droplevels(subset(base, condition == "window"))
ft <- aggregate(cbind(required_fact_present, correct) ~ recency + fact_position, w, mean)
S$window_cells <- ft
for (i in seq_len(nrow(ft))) say(sprintf("  %-5s / %-7s fact in prompt %5.1f%%   correct %5.1f%%", ft$recency[i], ft$fact_position[i], 100 * ft$required_fact_present[i], 100 * ft$correct[i]))
# Early/current is near-perfect (fact kept in 100%, 97.6% correct), which separates
# a logistic interaction term. The interaction is therefore estimated directly as a
# difference-in-differences of correctness, with a scenario-cluster bootstrap.
did <- function(d) {
  m <- function(r, f) mean(d$correct[d$recency == r & d$fact_position == f])
  (m("late", "current") - m("early", "current")) - (m("late", "root") - m("early", "root"))
}
bt2 <- cluster_boot(w, did)
S$window_did <- list(estimate = bt2[["est"]], lo = bt2[["lo"]], hi = bt2[["hi"]])
say(sprintf("  recency x fact position, difference-in-differences of correctness: %+.1f pts [%+.1f, %+.1f]",
            100 * bt2["est"], 100 * bt2["lo"], 100 * bt2["hi"]))
for (f in c("root", "current")) {
  bt <- cluster_boot(subset(w, fact_position == f), function(d) mean(d$correct[d$recency == "late"]) - mean(d$correct[d$recency == "early"]))
  S[[paste0("window_late_minus_early_", f)]] <- list(estimate = bt[["est"]], lo = bt[["lo"]], hi = bt[["hi"]])
  say(sprintf("  late - early siblings, fact near %-7s: %+.1f pts [%+.1f, %+.1f]", f, 100 * bt["est"], 100 * bt["lo"], 100 * bt["hi"]))
}
# correctness given whether the required fact survived
ff <- aggregate(correct ~ required_fact_present, w, function(x) c(k = sum(x), n = length(x)))
S$window_correct_by_fact <- lapply(seq_len(nrow(ff)), function(i) { r <- cp(ff$correct[i, "k"], ff$correct[i, "n"])
  say(sprintf("  window, fact %s: correct %.1f%% [%.1f, %.1f] (n = %d)", ifelse(ff$required_fact_present[i] == 1, "in prompt ", "displaced"), 100 * r[["rate"]], 100 * r[["lo"]], 100 * r[["hi"]], r[["n"]]))
  list(fact_present = ff$required_fact_present[i], rate = r[["rate"]], lo = r[["lo"]], hi = r[["hi"]], n = r[["n"]]) })

# ------------------------------------------------- 3. quality: paired comparisons
say("== 3. Quality: paired by scenario x model (Wilcoxon signed-rank; cluster-bootstrap mean difference) ==")
measures <- c(correct = "correct", correct_strict = "correct_strict", faithfulness = "q_faithfulness", instruction = "q_instruction", task = "q_task")
wide <- reshape(base[, c("scenario", "model_role", "condition", unname(measures))], idvar = c("scenario", "model_role"), timevar = "condition", direction = "wide")
qres <- list()
for (cmp in c("window", "full_tree")) for (nm in names(measures)) {
  x <- wide[[paste0(measures[[nm]], ".ancestor")]]; y <- wide[[paste0(measures[[nm]], ".", cmp)]]
  ok <- !is.na(x) & !is.na(y); d <- data.frame(scenario = wide$scenario[ok], diff = y[ok] - x[ok])
  wt <- suppressWarnings(wilcox.test(y[ok], x[ok], paired = TRUE, exact = FALSE))
  bt <- cluster_boot(d, function(z) mean(z$diff))
  qres[[length(qres) + 1]] <- list(comparison = paste(cmp, "- ancestor"), measure = nm, n_pairs = sum(ok),
                                   mean_ancestor = mean(x[ok]), mean_other = mean(y[ok]), diff = bt[["est"]], lo = bt[["lo"]], hi = bt[["hi"]], p = wt$p.value)
}
ph <- p.adjust(sapply(qres, `[[`, "p"), "holm")
for (i in seq_along(qres)) { qres[[i]]$p_holm <- ph[i]; r <- qres[[i]]
  say(sprintf("  %-20s %-12s ancestor %.3f vs %.3f  diff %+.3f [%+.3f, %+.3f]  p_holm = %.3g  (n = %d)", r$comparison, r$measure, r$mean_ancestor, r$mean_other, r$diff, r$lo, r$hi, r$p_holm, r$n_pairs)) }
S$quality_paired <- qres

# ------------------------------------- 4. consistent siblings: price of ancestor-only
say("== 4. Consistent siblings: does using the sibling detail change quality? (full tree + window) ==")
cs <- droplevels(subset(base, type == "consistent" & condition != "ancestor"))
cs$leak_used_f <- factor(cs$leak_used)
desc4 <- aggregate(cbind(correct, q_faithfulness, q_task) ~ condition + required_fact_present + leak_used, cs, function(x) round(mean(x), 3))
S$consistent_desc <- desc4
print(desc4)
# Correctness: every answer that used the consistent detail was correct, which
# separates a logistic model. Report exact rates and a Fisher exact test in the
# stratum where it matters (required fact displaced from the prompt).
cc <- aggregate(correct ~ required_fact_present + leak_used, cs, function(x) c(k = sum(x), n = length(x)))
S$consistent_correct <- lapply(seq_len(nrow(cc)), function(i) { r <- cp(cc$correct[i, "k"], cc$correct[i, "n"])
  say(sprintf("  correct | fact %s, detail %s: %.1f%% [%.1f, %.1f] (n = %d)", ifelse(cc$required_fact_present[i] == 1, "in prompt", "displaced"),
              ifelse(cc$leak_used[i] == 1, "used    ", "not used"), 100 * r[["rate"]], 100 * r[["lo"]], 100 * r[["hi"]], r[["n"]]))
  list(fact_present = cc$required_fact_present[i], leak_used = cc$leak_used[i], rate = r[["rate"]], lo = r[["lo"]], hi = r[["hi"]], n = r[["n"]]) })
dz <- subset(cs, required_fact_present == 0)
fz <- fisher.test(table(dz$leak_used, dz$correct))
S$consistent_fisher_displaced <- list(p = fz$p.value, OR = unname(fz$estimate), lo = fz$conf.int[[1]], hi = fz$conf.int[[2]])
say(sprintf("  fact displaced: Fisher exact test of correctness by use, p = %.3g", fz$p.value))
# Judge scores (no separation): linear mixed models
m4t <- lmer(q_task ~ leak_used + condition + required_fact_present + model_role + (1 | scenario), data = cs)
m4f <- lmer(q_faithfulness ~ leak_used + condition + required_fact_present + model_role + (1 | scenario), data = cs)
t4 <- summary(m4t)$coefficients["leak_used", ]; it4 <- confint(m4t, parm = "leak_used", method = "Wald")
f4 <- summary(m4f)$coefficients["leak_used", ]; if4 <- confint(m4f, parm = "leak_used", method = "Wald")
p_t <- 2 * pnorm(-abs(t4[["t value"]])); p_f <- 2 * pnorm(-abs(f4[["t value"]]))
S$consistent_models <- list(task = list(b = t4[[1]], lo = it4[1], hi = it4[2], p = p_t), faithfulness = list(b = f4[[1]], lo = if4[1], hi = if4[2], p = p_f))
say(sprintf("  task completion when the detail was used: %+.2f points [%+.2f, %+.2f], p = %.3g (adjusted for condition, fact in prompt, model)", t4[[1]], it4[1], it4[2], p_t))
say(sprintf("  faithfulness when the detail was used:    %+.2f points [%+.2f, %+.2f], p = %.3g", f4[[1]], if4[1], if4[2], p_f))

# --------------------------------------------------------------- 5. token efficiency
say("== 5. Token efficiency ==")
sc <- read.csv("results/analysis/scenarios.csv")
S$efficiency_max_abs_formula_gap <- max(abs(sc$efficiency - sc$sibling_share))
ef <- do.call(rbind, lapply(split(sc, list(sc$depth, sc$siblings)), function(d) {
  m <- mean(d$efficiency); se <- sd(d$efficiency) / sqrt(nrow(d))
  data.frame(depth = d$depth[1], siblings = d$siblings[1], mean = m, lo = m - 1.96 * se, hi = m + 1.96 * se, n = nrow(d)) }))
ef <- ef[order(ef$depth, ef$siblings), ]; S$efficiency <- ef
say(sprintf("  overall mean E = %.1f%%; max |E - sibling share| = %.2e", 100 * mean(sc$efficiency), S$efficiency_max_abs_formula_gap))
for (i in seq_len(nrow(ef))) say(sprintf("  depth %d, %d siblings: %.1f%% [%.1f, %.1f]", ef$depth[i], ef$siblings[i], 100 * ef$mean[i], 100 * ef$lo[i], 100 * ef$hi[i]))

# ------------------------------------------------------------ 6. run-to-run variance
say("== 6. Run-to-run variance (73 scenarios run 3 times) ==")
rp <- subset(a, no_answer == 0 & scenario %in% unique(a$scenario[a$rep > 0]))
agg <- aggregate(cbind(leak_used, correct, q_task) ~ scenario + model_role + condition, rp,
                 function(x) c(n = length(x), same = as.numeric(length(unique(x)) == 1), sd = sd(x)))
var_tab <- do.call(rbind, lapply(split(agg, list(agg$model_role, agg$condition)), function(d) {
  full3 <- d$leak_used[, "n"] == 3
  data.frame(model = d$model_role[1], condition = d$condition[1], groups = sum(full3),
             leak_agree = mean(d$leak_used[full3, "same"]), correct_agree = mean(d$correct[full3, "same"]), task_sd = mean(d$q_task[full3, "sd"])) }))
S$variance <- var_tab
for (i in seq_len(nrow(var_tab))) say(sprintf("  %-12s %-9s leak identical across runs %5.1f%%, correct identical %5.1f%%, mean SD of task score %.2f (n = %d)",
                                             var_tab$model[i], var_tab$condition[i], 100 * var_tab$leak_agree[i], 100 * var_tab$correct_agree[i], var_tab$task_sd[i], var_tab$groups[i]))

dir.create("results/analysis", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(S, auto_unbox = TRUE, digits = 6, pretty = TRUE, force = TRUE), "results/analysis/stats.json")
writeLines(txt, "results/analysis/stats.txt")
cat("\nwrote results/analysis/stats.json and stats.txt\n")
cat("R", R.version$major, ".", R.version$minor, " lme4 ", as.character(packageVersion("lme4")), " emmeans ", as.character(packageVersion("emmeans")), "\n", sep = "")
