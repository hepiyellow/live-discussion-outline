Title: Rate limiting for a public API

# 1. @user-approved Where to enforce the limits

Decided: enforce at the gateway.

## 1.1 @user-approved Gateway, not in each service

- 1.1.1 One place to change; services stay simple
- 1.1.2 Cost: the gateway must know the customer identity

## 1.2 @user-approved Per-service limits as a second layer

- 1.2.1 Rejected: duplicates logic and drifts out of sync

# 2. Which algorithm

Token bucket allows short bursts while holding a steady average rate. Fixed windows are simpler but let a client double its rate at a window boundary.

## 2.1 Token bucket or sliding window?

### 2.1.1 @user-approved Fixed window: simple, but the boundary double-burst rules it out

### 2.1.2 @current Sliding window counter: less memory than a full log, about ±5% error

### 2.1.3 Is ±5% acceptable for limits tied to billing?

## 2.2 Where do the counters live?

### 2.2.1 Redis with a Lua script keeps the check atomic

### 2.2.2 In-process counters would multiply the limit by the number of gateways

# 3. What clients see when throttled

## 3.1 Status code and headers

### 3.1.1 `429 Too Many Requests` with `Retry-After`

### 3.1.2 Expose remaining quota in response headers?

## 3.2 Burst allowance for new customers

# 4. @user-approved Scope of the first release

## 4.1 @user-approved Per API key only; per-IP limits come later

- 4.1.1 IP limits need a decision about shared NATs first
