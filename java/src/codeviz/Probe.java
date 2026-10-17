package codeviz;

/** Debugger identity hooks. Arguments are evaluated exactly once, in Java's original order. */
public final class Probe {
    private Probe() {}

    public static int begin(String id) { return 0; }
    public static boolean condition(String id, int evaluation, boolean outcome) {
        return outcome;
    }
    public static boolean operand(String site, String id, boolean value) { return value; }
    public static byte operand(String site, String id, byte value) { return value; }
    public static short operand(String site, String id, short value) { return value; }
    public static char operand(String site, String id, char value) { return value; }
    public static int operand(String site, String id, int value) { return value; }
    public static long operand(String site, String id, long value) { return value; }
    public static float operand(String site, String id, float value) { return value; }
    public static double operand(String site, String id, double value) { return value; }
    public static <T> T operand(String site, String id, T value) { return value; }
}
