/* A tiny stand-in for a closed-source native app: a long-running CLI that
 * prices tickets. compute_total() is the function Morse changes by signature.
 *
 * Build it stripped (no symbols), the closed-source case:
 *   cc -O1 -o ticketd ticketd.c && strip ticketd
 * Then run native-dbi/example/add-feature.mjs (see README.md).
 */
#include <stdio.h>
#include <unistd.h>

__attribute__((noinline)) int compute_total(int base, int qty) {
    volatile int b = base, q = qty;   /* keep it a real call, not folded away */
    return b * q;
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    int tick = 0;
    while (1) {
        int qty = (tick % 5) + 1;          /* qty cycles 1..5 */
        int total = compute_total(19, qty);
        printf("[ticketd] qty=%d total=$%d\n", qty, total);
        tick++;
        usleep(400000);
    }
}
