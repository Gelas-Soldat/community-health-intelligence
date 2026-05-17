# Data Dictionary

## dim_county

| Column | Meaning |
|---|---|
| county_fips | 5 digit county identifier |
| county_name | County name |
| state_fips | 2 digit state identifier |
| state_name | State name |
| state_abbr | State abbreviation |
| region | Optional region grouping |

## dim_health_measure

| Column | Meaning |
|---|---|
| measure_id | Short measure code |
| measure_name | Human readable measure name |
| category | Outcome, behavior, or preventive care |
| direction | Whether higher values are better or worse |
| business_definition | Plain English explanation |

## fact_health_measures

County health indicators from CDC PLACES.

## fact_census_profile

County socioeconomic indicators from ACS 5 year estimates.

## fact_food_access

Tract level USDA food access data, joined to counties through FIPS logic.

## analytics_county_scores

Final dashboard scoring table used for executive reporting.
