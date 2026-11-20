//! 256-bit intermediate `a * b / c` so share-price maths (1e24-scaled) never overflows `u128`.

fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    const M: u128 = u64::MAX as u128;
    let (a1, a0) = (a >> 64, a & M);
    let (b1, b0) = (b >> 64, b & M);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & M) + (p10 & M);
    let lo = (p00 & M) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
}

/// `(floor(a*b/c), (a*b) % c)`; `None` when `c == 0` or the quotient does not fit in `u128`.
pub fn mul_div_rem(a: u128, b: u128, c: u128) -> Option<(u128, u128)> {
    if c == 0 {
        return None;
    }
    let (hi, lo) = mul_wide(a, b);
    if hi >= c {
        return None;
    }
    let mut rem = hi;
    let mut quot = 0u128;
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        quot <<= 1;
        if carry == 1 || rem >= c {
            rem = rem.wrapping_sub(c);
            quot |= 1;
        }
    }
    Some((quot, rem))
}

pub fn mul_div_floor(a: u128, b: u128, c: u128) -> Option<u128> {
    mul_div_rem(a, b, c).map(|(q, _)| q)
}

pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> Option<u128> {
    mul_div_rem(a, b, c).and_then(|(q, r)| if r > 0 { q.checked_add(1) } else { Some(q) })
}
