# Phase 7 figures, regenerated from results/analysis/answers.csv and scenarios.csv.
# Usage: Rscript analysis/figures.R   -> results/figures/fig*.png (300 dpi) and .pdf
lib <- Sys.getenv("R_LIBS_USER"); .libPaths(c(lib, .libPaths()))
suppressPackageStartupMessages({ library(ggplot2); library(ragg) })

dir.create("results/figures", showWarnings = FALSE, recursive = TRUE)
a <- read.csv("results/analysis/answers.csv", stringsAsFactors = FALSE)
b <- subset(a, rep == 0 & no_answer == 0)
COND <- c(ancestor = "Ancestor-only", full_tree = "Full tree", window = "Sliding window")
CCOL <- c("Ancestor-only" = "#2a78d6", "Full tree" = "#eb6834", "Sliding window" = "#1baf7a")
MOD <- c(frontier = "Gemini 4 Argon", mid = "GPT-6.2 Sol", open_weights = "Mistral Large 4")
b$cond <- factor(COND[b$condition], levels = COND)
b$type <- factor(b$type, levels = c("consistent", "conflicting", "misleading", "irrelevant"),
                 labels = c("Consistent", "Conflicting", "Misleading", "Irrelevant"))
b$model <- factor(MOD[b$model_role], levels = MOD)

theme_thesis <- theme_minimal(base_size = 11, base_family = "") +
  theme(panel.grid.major.x = element_blank(), panel.grid.minor = element_blank(),
        panel.grid.major.y = element_line(colour = "#e1e0d9", linewidth = 0.3),
        axis.line.x = element_line(colour = "#c3c2b7", linewidth = 0.4),
        axis.text = element_text(colour = "#52514e"), axis.title = element_text(colour = "#52514e"),
        legend.position = "top", legend.title = element_blank(), legend.justification = "left",
        plot.title = element_text(face = "bold", size = 12), plot.subtitle = element_text(colour = "#52514e", size = 9.5),
        plot.caption = element_text(colour = "#898781", size = 8, hjust = 0), plot.title.position = "plot", plot.caption.position = "plot")
pct <- function(x) paste0(round(100 * x), "%")
exact <- function(k, n) { r <- binom.test(k, n)$conf.int; c(lo = r[1], hi = r[2]) }
dir.create("results/figures/paper", showWarnings = FALSE, recursive = TRUE)
# Two versions of each figure: a titled one for slides/preview, and a paper one
# (title, subtitle and source live in the LaTeX caption) at IEEE column width.
save <- function(p, name, w = 7, h = 4.2, pw = 3.5, ph = 2.45) {
  ggsave(file.path("results/figures", paste0(name, ".png")), p, device = agg_png, width = w, height = h, dpi = 300, bg = "white")
  ggsave(file.path("results/figures", paste0(name, ".pdf")), p, width = w, height = h, bg = "white")
  pp <- p + labs(title = NULL, subtitle = NULL, caption = NULL) +
    theme(text = element_text(size = 7.5), axis.text = element_text(size = 6.8), legend.text = element_text(size = 6.8),
          legend.key.size = unit(7, "pt"), legend.margin = margin(0, 0, 0, 0), legend.box.spacing = unit(2, "pt"),
          plot.margin = margin(2, 12, 2, 2))
  for (i in seq_along(pp$layers)) if (inherits(pp$layers[[i]]$geom, "GeomText")) pp$layers[[i]]$aes_params$size <- 2.1
  ggsave(file.path("results/figures/paper", paste0(name, ".pdf")), pp, width = pw, height = ph, bg = "white")
  ggsave(file.path("results/figures/paper", paste0(name, ".png")), pp, device = agg_png, width = pw, height = ph, dpi = 300, bg = "white")
  cat("  ", name, "\n")
}
prop_ci <- function(d, y, by) {
  out <- aggregate(d[[y]], d[by], function(x) c(k = sum(x), n = length(x)))
  m <- out$x; out$x <- NULL
  out$rate <- m[, "k"] / m[, "n"]; ci <- t(mapply(exact, m[, "k"], m[, "n"])); out$lo <- ci[, 1]; out$hi <- ci[, 2]; out$n <- m[, "n"]
  out
}
dodge <- position_dodge(width = 0.78)

# Figure 1: leakage by sibling type and condition
f1 <- prop_ci(b, "leak_used", c("cond", "type"))
p1 <- ggplot(f1, aes(type, rate, fill = cond)) +
  geom_col(position = dodge, width = 0.72) +
  geom_errorbar(aes(ymin = lo, ymax = hi), position = dodge, width = 0.18, linewidth = 0.4, colour = "#0b0b0b") +
  geom_text(aes(y = hi + 0.025, label = pct(rate)), position = dodge, size = 2.8, colour = "#0b0b0b") +
  scale_fill_manual(values = CCOL) + scale_y_continuous(labels = pct, limits = c(0, 0.5), expand = c(0, 0)) +
  labs(x = NULL, y = "Answers using a sibling-only detail",
       title = "Sibling leakage by sibling type", subtitle = "Judge-confirmed use of a detail found only in an inactive branch; 95% exact intervals",
       caption = "First run per scenario, three models pooled (about 540 answers per bar). Ancestor-only is zero by construction.") + theme_thesis
save(p1, "fig1_leakage")

# Figure 2: how flagged sibling terms were used
f2 <- aggregate(cbind(terms_used, terms_alternative, terms_rejected, terms_incidental) ~ cond, subset(b, condition != "ancestor"), sum)
f2l <- data.frame(cond = rep(f2$cond, 4), label = rep(c("Used", "Alternative", "Rejected", "Incidental"), each = nrow(f2)),
                  n = c(f2$terms_used, f2$terms_alternative, f2$terms_rejected, f2$terms_incidental))
f2l$label <- factor(f2l$label, levels = rev(c("Used", "Alternative", "Rejected", "Incidental")))
f2l$share <- ave(f2l$n, f2l$cond, FUN = function(x) x / sum(x))
p2 <- ggplot(f2l, aes(cond, share, fill = label)) + geom_col(width = 0.6, colour = "white", linewidth = 0.6) +
  geom_text(aes(label = ifelse(share > 0.06, pct(share), "")), position = position_stack(vjust = 0.5), size = 3, colour = "white") +
  coord_flip() + scale_fill_manual(values = c("Used" = "#0d366b", "Alternative" = "#1c5cab", "Rejected" = "#3987e5", "Incidental" = "#86b6ef"), breaks = c("Used", "Alternative", "Rejected", "Incidental")) +
  scale_y_continuous(labels = pct, expand = c(0, 0)) +
  labs(x = NULL, y = "Share of flagged terms", title = "String matches overstate leakage", subtitle = "How the judge labelled each sibling term found in an answer",
       caption = "Leak judge (Claude Opus 5.5) saw only the answer and the flagged terms.") + theme_thesis +
  theme(panel.grid.major.y = element_blank(), plot.margin = margin(5.5, 16, 5.5, 5.5))
save(p2, "fig2_term_usage", h = 2.8, ph = 1.7)

# Figure 3: token efficiency
sc <- read.csv("results/analysis/scenarios.csv")
f3 <- do.call(rbind, lapply(split(sc, list(sc$depth, sc$siblings)), function(d) { m <- mean(d$efficiency); se <- sd(d$efficiency) / sqrt(nrow(d))
  data.frame(depth = paste("Depth", d$depth[1]), siblings = d$siblings[1], mean = m, lo = m - 1.96 * se, hi = m + 1.96 * se) }))
f3$depth <- factor(f3$depth, levels = c("Depth 2", "Depth 4", "Depth 8"))
p3 <- ggplot(f3, aes(siblings, mean, colour = depth)) + geom_line(linewidth = 0.8) + geom_point(size = 2.4) +
  geom_errorbar(aes(ymin = lo, ymax = hi), width = 0.12, linewidth = 0.4) +
  geom_text(data = subset(f3, siblings == 5), aes(label = paste0(depth, ": ", pct(mean))), hjust = -0.15, size = 3, show.legend = FALSE) +
  scale_colour_manual(values = c("Depth 2" = "#2a78d6", "Depth 4" = "#eb6834", "Depth 8" = "#1baf7a")) +
  scale_x_continuous(breaks = c(1, 3, 5), limits = c(0.8, 6.3)) + scale_y_continuous(labels = pct, limits = c(0, 1), expand = c(0, 0)) +
  labs(x = "Sibling branches", y = "Token efficiency E", title = "Token savings of ancestor-only over full tree",
       subtitle = "E = 1 - w(ancestor)/w(full tree), equal to the siblings' share of the tree (Proposition 1)", caption = "80 scenarios per point; reference tokenizer o200k_base.") + theme_thesis
save(p3, "fig3_efficiency")

# Figure 4: correctness by model and condition
f4 <- prop_ci(b, "correct", c("model", "cond"))
p4 <- ggplot(f4, aes(model, rate, fill = cond)) + geom_col(position = dodge, width = 0.72) +
  geom_errorbar(aes(ymin = lo, ymax = hi), position = dodge, width = 0.18, linewidth = 0.4) +
  geom_text(aes(y = hi + 0.03, label = pct(rate)), position = dodge, size = 2.8) +
  scale_fill_manual(values = CCOL) + scale_y_continuous(labels = pct, limits = c(0, 1.08), breaks = seq(0, 1, 0.25), expand = c(0, 0)) +
  labs(x = NULL, y = "Answers correct", title = "Correctness by model and condition", subtitle = "States the required value and no conflicting sibling value; 95% exact intervals",
       caption = "About 720 answers per bar.") + theme_thesis
save(p4, "fig4_correctness")

# Figure 5: judge quality by condition
ql <- rbind(data.frame(cond = b$cond, measure = "Contextual faithfulness", score = as.numeric(b$q_faithfulness)),
            data.frame(cond = b$cond, measure = "Instruction following", score = as.numeric(b$q_instruction)),
            data.frame(cond = b$cond, measure = "Task completion", score = as.numeric(b$q_task)))
f5 <- do.call(rbind, lapply(split(ql, list(ql$cond, ql$measure)), function(d) { m <- mean(d$score); se <- sd(d$score) / sqrt(nrow(d))
  data.frame(cond = d$cond[1], measure = d$measure[1], mean = m, lo = m - 1.96 * se, hi = m + 1.96 * se) }))
p5 <- ggplot(f5, aes(measure, mean, fill = cond)) + geom_col(position = dodge, width = 0.72) +
  geom_errorbar(aes(ymin = lo, ymax = hi), position = dodge, width = 0.18, linewidth = 0.4) +
  geom_text(aes(y = hi + 0.15, label = sprintf("%.2f", mean)), position = dodge, size = 2.8) +
  scale_fill_manual(values = CCOL) + scale_y_continuous(limits = c(0, 5.4), breaks = 1:5, expand = c(0, 0)) +
  labs(x = NULL, y = "Mean judge score (1-5)", title = "Answer quality by condition", subtitle = "Blind LLM judge saw only the active path, the question and the answer; 95% intervals",
       caption = "About 2,160 answers per bar, three models pooled.") + theme_thesis
save(p5, "fig5_quality")

# Figure 6: sliding window, recency x fact position
w <- subset(b, condition == "window")
w$cell <- factor(paste0(ifelse(w$recency == "early", "Early", "Late"), "\n", ifelse(w$fact_position == "root", "root fact", "current fact")),
                 levels = c("Early\nroot fact", "Early\ncurrent fact", "Late\nroot fact", "Late\ncurrent fact"))
f6 <- rbind(transform(prop_ci(w, "required_fact_present", "cell"), measure = "Required fact still in prompt"),
            transform(prop_ci(w, "correct", "cell"), measure = "Answered correctly"))
f6$measure <- factor(f6$measure, levels = c("Required fact still in prompt", "Answered correctly"))
p6 <- ggplot(f6, aes(cell, rate, fill = measure)) + geom_col(position = dodge, width = 0.72) +
  geom_errorbar(aes(ymin = lo, ymax = hi), position = dodge, width = 0.18, linewidth = 0.4) +
  geom_text(aes(y = hi + 0.045, label = pct(rate)), position = dodge, size = 2.8) +
  scale_fill_manual(values = c("Required fact still in prompt" = "#1baf7a", "Answered correctly" = "#52514e")) +
  scale_y_continuous(labels = pct, limits = c(0, 1.08), breaks = seq(0, 1, 0.25), expand = c(0, 0)) +
  labs(x = "Sibling recency and position of the required fact", y = NULL, title = "What the sliding window loses", subtitle = "Root-side facts are always displaced when siblings exist (Proposition 5)",
       caption = "About 540 window answers per cell.") + theme_thesis
save(p6, "fig6_window_displacement")

# Figure 7: consistent siblings, quality when the detail was used vs not
cs <- subset(b, type == "Consistent" & condition != "ancestor")
cs$used <- factor(ifelse(cs$leak_used == 1, "Used the sibling detail", "Did not use it"), levels = c("Did not use it", "Used the sibling detail"))
cs$fact <- factor(ifelse(cs$required_fact_present == 1, "Required fact in prompt", "Required fact displaced"), levels = c("Required fact in prompt", "Required fact displaced"))
f7 <- prop_ci(cs, "correct", c("fact", "used"))
p7 <- ggplot(f7, aes(fact, rate, fill = used)) + geom_col(position = dodge, width = 0.66) +
  geom_errorbar(aes(ymin = lo, ymax = hi), position = dodge, width = 0.18, linewidth = 0.4) +
  geom_text(aes(y = hi + 0.045, label = pct(rate)), position = dodge, size = 2.8) +
  geom_label(aes(y = 0.06, label = paste0("n = ", n), group = used), position = dodge, size = 2.3, fill = "white", label.size = 0, label.padding = unit(1.5, "pt")) +
  scale_fill_manual(values = c("Did not use it" = "#86b6ef", "Used the sibling detail" = "#1c5cab")) +
  scale_y_continuous(labels = pct, limits = c(0, 1.1), breaks = seq(0, 1, 0.25), expand = c(0, 0)) +
  labs(x = NULL, y = "Answers correct", title = "The price of ancestor-only: consistent siblings",
       subtitle = "Full tree and window answers with a consistent sibling, split by whether they used its detail", caption = "95% exact intervals.") + theme_thesis
save(p7, "fig7_consistent_price")
cat("figures written to results/figures\n")
