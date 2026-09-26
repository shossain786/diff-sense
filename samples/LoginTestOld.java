import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;

public class LoginTest {
    private int timeout = 30;

    @Test
    void login() {
        driver.findElement(By.id("login")).click();
        new WebDriverWait(driver, Duration.ofSeconds(10)).until(ready);
        assertEquals("Home", driver.getTitle());
    }
}
