Title: Caching for the search service
Resume: claude --resume 3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f
Model: Claude Opus 5.5, high
Terminal: ldo-sample
Session: 3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f

The search service answers in 900 ms at p95. This outline decides how to cache its results.

# 1. @user-approved Goals

## 1.1 @user-approved Cut p95 latency below 200 ms

## 1.2 @user-approved Keep results fresh within a minute

Stale results confuse users who just edited a document.

# 2. Where the cache lives

Two places could hold the cache, and the choice drives everything after it.

## 2.1 @options Cache placement

Where cached results are kept. Pick one of the options below.

### 2.1.1 @option_A In each service instance

Fast, but every instance warms its own copy.

### 2.1.2 @recommended @option_B A shared Redis cluster

One warm copy for all instances, at the cost of a network hop.

## 2.2 @user-approved @options Eviction policy

Which entries leave first when memory runs out. Pick one of the options below.

### 2.2.1 @user-approved @option_A Least recently used

### 2.2.2 @recommended @option_B Least frequently used

## 2.3 @agent-claim Cache key

The key is the normalized query plus the user's locale and the tenant.
Results differ by tenant as well as by locale, so both are part of it.

- Normalize case and whitespace
- Sort the filters by name

@Summary. The key combines the normalized query, the locale and the tenant.

@Recommendation. Hash the key with SHA-1 so long queries stay small.

## 2.4 @action Measure the hit rate on staging

Replay yesterday's queries against staging with the cache on.

@Action. Runs the replay script against staging and reports the hit rate.

## 2.5 @action-done Add cache metrics to the dashboard

Hits, misses and evictions now show on the search dashboard.

# 3. Invalidation

## 3.1 Events that drop entries

### 3.1.1 Index updates

#### 3.1.1.1 Reindexing

##### 3.1.1.1.1 Partial reindex of one shard

###### 3.1.1.1.1.1 @current Drop only that shard's entries

The key would need the shard id, which the gateway does not know yet:

```
key = hash(query, locale, version, shard)
```

## 3.2 Time to live

Entries expire after 60 seconds whatever happens.

@Recommendation. Keep 60 seconds until the hit rate is measured.

## 3.3 Who can flush the cache by hand

## 3.4 Warming the cache after a deploy

Replay the top thousand queries before taking traffic.

# 4. @agent-claim Rollout

## 4.1 @user-approved Behind a feature flag per tenant

## 4.2 @agent-claim Start with internal tenants

# @queue
- 2.1 @decide Pick where the cache lives.
- 2.4 @action Measure the hit rate on staging.
- 2.3 @approve The cache key you recommended.
- 3.1.1.1.1.1 @read Why shard-level invalidation needs the shard id.
