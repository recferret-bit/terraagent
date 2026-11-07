/**
 * The most a buyer can be charged for an order whose total quote is `priceAmount` (principal + platform fee + maximum stall fee,
 * floors as the cumulative bucket rule charges them). One rule for the sim's cargo check and this server's reservation, so the sim
 * never accepts an order the server then rejects for funds.
 */
export { maxBuyerSpend } from '@terra/sim/systems/trade/market-fees';
