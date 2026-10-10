int apply_op(int op, int a, int b) {
    switch (op) {
    case 0: return a + b;
    case 1: return a - b;
    case 2: return a * b;
    case 3: return b ? a / b : 0;
    case 4: return a & b;
    case 5: return a | b;
    case 6: return a ^ b;
    default: return -1;
    }
}
