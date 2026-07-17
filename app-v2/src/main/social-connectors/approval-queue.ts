import {
  SOCIAL_APPROVAL_SCHEMA,
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  type SocialActorV1,
  type SocialApprovalConsumeRequestV1,
  type SocialApprovalConsumeResultV1,
  type SocialApprovalQueueV1,
  type SocialApprovalReceiptV1,
  type SocialApprovalRequestV1
} from '../../shared/social-connectors'
import { cloneSocialValue, socialHash } from './security'

export class DeterministicSocialApprovalQueue implements SocialApprovalQueueV1 {
  readonly #requests = new Map<string, SocialApprovalRequestV1>()
  readonly #receipts = new Map<string, SocialApprovalReceiptV1>()
  readonly #requestReceipts = new Map<string, string>()

  enqueue(request: SocialApprovalRequestV1): SocialApprovalRequestV1 {
    if (
      request.schema !== SOCIAL_APPROVAL_SCHEMA ||
      request.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION ||
      request.state !== 'pending' ||
      request.oneShot !== true
    ) {
      throw new Error('Invalid social approval request contract')
    }
    if (request.expiresAtMs <= request.createdAtMs) {
      throw new Error('Social approval request must expire after creation')
    }
    if (this.#requests.has(request.requestId)) {
      throw new Error(`Duplicate social approval request: ${request.requestId}`)
    }

    const stored = cloneSocialValue(request)
    this.#requests.set(stored.requestId, stored)
    return cloneSocialValue(stored)
  }

  decide(
    requestId: string,
    state: 'approved' | 'rejected' | 'cancelled',
    actor: SocialActorV1,
    reason: string,
    nowMs: number
  ): SocialApprovalReceiptV1 {
    const request = this.#requests.get(requestId)
    if (!request) throw new Error(`Unknown social approval request: ${requestId}`)
    if (this.#requestReceipts.has(requestId)) {
      throw new Error(`Social approval request already decided: ${requestId}`)
    }

    const finalState = nowMs > request.expiresAtMs ? 'expired' : state
    const approvalRef = `approval:${socialHash({
      requestId,
      state: finalState,
      actor,
      nowMs
    }).slice('sha256:'.length, 'sha256:'.length + 24)}`
    const receipt: SocialApprovalReceiptV1 = {
      schema: SOCIAL_APPROVAL_SCHEMA,
      contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
      approvalRef,
      requestId,
      provider: request.provider,
      capabilityId: request.capabilityId,
      destination: request.destination,
      decisionBy: cloneSocialValue(actor),
      decisionReason: reason,
      decidedAtMs: nowMs,
      expiresAtMs: request.expiresAtMs,
      oneShot: true,
      state: finalState
    }

    this.#receipts.set(approvalRef, receipt)
    this.#requestReceipts.set(requestId, approvalRef)
    return cloneSocialValue(receipt)
  }

  consume(request: SocialApprovalConsumeRequestV1): SocialApprovalConsumeResultV1 {
    const receipt = this.#receipts.get(request.approvalRef)
    if (!receipt) return { allowed: false, reasonCode: 'approval.missing' }
    if (receipt.state === 'consumed') return { allowed: false, reasonCode: 'approval.consumed' }
    if (receipt.state !== 'approved') {
      return { allowed: false, reasonCode: `approval.${receipt.state}` }
    }
    if (request.nowMs > receipt.expiresAtMs) {
      const expired = { ...receipt, state: 'expired' as const }
      this.#receipts.set(receipt.approvalRef, expired)
      return { allowed: false, reasonCode: 'approval.expired', receipt: cloneSocialValue(expired) }
    }
    if (
      receipt.provider !== request.provider ||
      receipt.capabilityId !== request.capabilityId ||
      receipt.destination !== request.destination
    ) {
      return { allowed: false, reasonCode: 'approval.scope_mismatch' }
    }

    const consumed = { ...receipt, state: 'consumed' as const }
    this.#receipts.set(receipt.approvalRef, consumed)
    return { allowed: true, reasonCode: 'approval.consumed', receipt: cloneSocialValue(consumed) }
  }

  getRequest(requestId: string): SocialApprovalRequestV1 | undefined {
    const request = this.#requests.get(requestId)
    return request ? cloneSocialValue(request) : undefined
  }

  getReceipt(approvalRef: string): SocialApprovalReceiptV1 | undefined {
    const receipt = this.#receipts.get(approvalRef)
    return receipt ? cloneSocialValue(receipt) : undefined
  }
}
