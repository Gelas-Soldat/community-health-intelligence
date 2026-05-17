# Project Plan

## BI Framing

This project is built from the perspective of a Business Intelligence Analyst supporting public health resource planning. The work starts with a stakeholder problem, turns that problem into measurable KPIs, models the data, writes SQL logic, and ends with a dashboard that helps decision makers act.

## Problem Statement

Public health leaders need a practical way to identify counties where health risk, poverty, and limited food access overlap. Looking at one metric at a time can hide the full picture. A county may not be the worst nationally for diabetes, but it may still be a high priority because poverty and food access pressure make intervention harder.

## Business Objective

Create a county level prioritization model that helps stakeholders decide where outreach, screenings, education, and funding should be focused first.

## Scope

Version 1 focuses on a small set of states so the project stays realistic and easy to explain. Version 2 can expand nationwide.

## Success Criteria

* Clean PostgreSQL database with normalized tables
* Repeatable ETL scripts
* SQL queries showing beginner through advanced skills
* Dashboard ready views
* Priority score methodology
* Netlify hosted dashboard
* GitHub README written like a real analytics case study

## Stakeholder Questions

* Which counties should we prioritize first?
* Why are these counties high risk?
* Is the issue mainly health outcomes, economic pressure, food access, or a mix?
* Which counties are outliers compared with their state peers?
* What evidence supports the recommendation?

## Priority Score Logic

Suggested weighting:

* Health Risk Score: 50 percent
* Economic Risk Score: 30 percent
* Food Access Score: 20 percent

This weighting keeps the model focused on health while still accounting for practical barriers that affect outreach and outcomes.

## Analyst Notes

The scoring model should be described as a decision support tool, not a medical or policy conclusion. The purpose is to guide prioritization and ask better questions.
